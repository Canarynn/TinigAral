// ============================================================
// DINIG — Audio Auralization Engine
// Native Web Audio API DSP pipeline with zero external audio assets
// Features: Continuous Rain Layer, Dynamic Moving Spatial Vehicles,
// Pre-cached Reverb IR Bank, and Procedural Synthesizers
// ============================================================

import type { RoomState } from '../types/room';
import { computeAcoustics, type AcousticMetrics } from './acoustics';
import { PRESET_HIGHWAY_CONCRETE } from '../data/presets';

const BASELINE_METRICS = computeAcoustics(PRESET_HIGHWAY_CONCRETE);

export type AudioSourceType = 'builtin' | 'upload' | 'mic';
export type VehicleType = 'tricycle' | 'motorcycle' | 'jeepney';

export interface ActiveVehicleState {
  id: string;
  type: VehicleType;
  label: string;
  x: number;
  y: number;
  speed: number;
  dbA: number;
  progress: number;
}

export interface AudioEngineState {
  isPlaying: boolean;
  sourceType: AudioSourceType;
  isABBaseline: boolean;
  isRecording: boolean;
  recordingSecondsLeft: number;
  hasCustomUpload: boolean;
  hasMicRecording: boolean;
  isRainActive: boolean;
  rainVolume: number;
  activeVehicles: ActiveVehicleState[];
}

interface ActiveVehicleAudioNode {
  state: ActiveVehicleState;
  sourceNode: AudioBufferSourceNode;
  pannerNode: StereoPannerNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number;
}

class AudioAuralizationEngine {
  private ctx: AudioContext | null = null;

  // Master & routing nodes
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  // Speech nodes
  private speechSourceNode: AudioBufferSourceNode | null = null;
  private speechFilterNode: BiquadFilterNode | null = null;
  private speechDirectGain: GainNode | null = null;
  private speechRevGain: GainNode | null = null;
  private convolverNode: ConvolverNode | null = null;

  // Ambient Noise nodes (steady roadside traffic)
  private noiseSourceNode: AudioBufferSourceNode | null = null;
  private noiseGainNode: GainNode | null = null;
  private noiseFilterNode: BiquadFilterNode | null = null;

  // Rain Layer nodes
  private rainSourceNode: AudioBufferSourceNode | null = null;
  private rainGainNode: GainNode | null = null;
  private rainFilterNode: BiquadFilterNode | null = null;
  private isRainActive = false;
  private rainVolume = 0.45;

  // Dynamic Moving Spatial Vehicles
  private activeVehicles: ActiveVehicleAudioNode[] = [];
  private vehicleIntervalTimer: number | null = null;
  private vehicleAnimRaf: number | null = null;
  private vehicleIdCounter = 1;
  private lastVehicleNotifyTime = 0;

  // Audio buffers
  private builtinSpeechBuffer: AudioBuffer | null = null;
  private customUploadBuffer: AudioBuffer | null = null;
  private micRecordingBuffer: AudioBuffer | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private rainBuffer: AudioBuffer | null = null;
  private vehicleEngineBuffer: AudioBuffer | null = null;

  // Pre-cached impulse response bank ($0.4s$ to $2.2s$ in $0.1s$ increments)
  private irCache: Map<number, AudioBuffer> = new Map();
  private currentConvolverRT60: number = -1;

  // Internal state
  private isPlaying = false;
  private playbackStart: Promise<void> | null = null;
  private sourceType: AudioSourceType = 'builtin';
  private isABBaseline = false;
  private lastRoom: RoomState | null = null;
  private lastMetrics: AcousticMetrics | null = null;

  // Recording
  private mediaRecorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private recordingInterval: number | null = null;

  // Listeners for UI state updates
  private stateChangeCallbacks: Array<(state: AudioEngineState) => void> = [];

  constructor() {
    // AudioContext will be initialized on first user gesture
  }

  public subscribe(cb: (state: AudioEngineState) => void): () => void {
    this.stateChangeCallbacks.push(cb);
    cb(this.getState());
    return () => {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter((c) => c !== cb);
    };
  }

  private notify() {
    const s = this.getState();
    this.stateChangeCallbacks.forEach((cb) => cb(s));
  }

  public getState(): AudioEngineState {
    return {
      isPlaying: this.isPlaying,
      sourceType: this.sourceType,
      isABBaseline: this.isABBaseline,
      isRecording: this.mediaRecorder !== null && this.mediaRecorder.state === 'recording',
      recordingSecondsLeft: 0,
      hasCustomUpload: this.customUploadBuffer !== null,
      hasMicRecording: this.micRecordingBuffer !== null,
      isRainActive: this.isRainActive,
      rainVolume: this.rainVolume,
      activeVehicles: this.activeVehicles.map((v) => ({ ...v.state })),
    };
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  // ── Procedural Speech Synthesizer ───────────────────────────
  private generateBuiltinSpeechBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 5.0; // 5-second seamless loop
    const totalSamples = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
    const data = buffer.getChannelData(0);

    const vowels = [
      { f1: 730, f2: 1090, f3: 2440 },
      { f1: 530, f2: 1840, f3: 2480 },
      { f1: 270, f2: 2290, f3: 3010 },
      { f1: 570, f2: 840,  f3: 2410 },
      { f1: 300, f2: 870,  f3: 2240 },
    ];

    const syllablesCount = 14;
    const sylDuration = duration / syllablesCount;
    let phase = 0;

    for (let s = 0; s < syllablesCount; s++) {
      const sylStart = Math.floor(s * sylDuration * sampleRate);
      const sylEnd = Math.floor((s + 1) * sylDuration * sampleRate);
      const v = vowels[s % vowels.length];
      const isConsonant = s % 2 === 0;
      const baseF0 = 140 + 20 * Math.sin((s / syllablesCount) * Math.PI * 2);

      for (let i = sylStart; i < sylEnd; i++) {
        const tInSyl = (i - sylStart) / sampleRate;
        const sylProgress = tInSyl / sylDuration;

        let sylEnv = 0;
        if (sylProgress < 0.15) {
          sylEnv = sylProgress / 0.15;
        } else if (sylProgress < 0.8) {
          sylEnv = 1.0;
        } else if (sylProgress < 0.95) {
          sylEnv = 1.0 - (sylProgress - 0.8) / 0.15;
        }

        const f0 = baseF0 + 5 * Math.sin(tInSyl * 12);
        phase += f0 / sampleRate;
        if (phase > 1) phase -= 1;
        const glottal = Math.exp(-phase * 3) * (1 - phase);

        const tGlobal = i / sampleRate;
        const formants =
          0.5 * Math.sin(2 * Math.PI * v.f1 * tGlobal) +
          0.3 * Math.sin(2 * Math.PI * v.f2 * tGlobal) +
          0.15 * Math.sin(2 * Math.PI * v.f3 * tGlobal);

        let consonantNoise = 0;
        if (isConsonant && sylProgress < 0.1) {
          const noiseEnv = 1.0 - sylProgress / 0.1;
          const white = Math.random() * 2 - 1;
          consonantNoise = white * noiseEnv * 0.45;
        }

        data[i] = (glottal * formants * 0.85 + consonantNoise) * sylEnv * 0.7;
      }
    }

    // Peak normalization
    let peak = 0;
    for (let i = 0; i < totalSamples; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0) {
      const scale = 0.89 / peak;
      for (let i = 0; i < totalSamples; i++) data[i] *= scale;
    }

    return buffer;
  }

  // ── Procedural Traffic Noise Buffer ─────────────────────────
  private generateNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 5.0;
    const totalSamples = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let enginePhase = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;

      // Pink noise filter
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;

      const rpmHz = 28 + 4 * Math.sin(t * 1.5) + 2 * Math.cos(t * 3.7);
      enginePhase += rpmHz / sampleRate;
      if (enginePhase > 1) enginePhase -= 1;
      const enginePulse = Math.sin(enginePhase * Math.PI * 2) * Math.exp(-enginePhase * 2.5);

      const rumble = 0.35 * Math.sin(2 * Math.PI * 48 * t) + 0.2 * Math.sin(2 * Math.PI * 96 * t);
      data[i] = (pink * 0.6 + enginePulse * 0.7 + rumble * 0.4) * 0.75;
    }

    return buffer;
  }

  // ── Procedural Continuous Rain Layer Buffer ─────────────────
  // Synthesizes natural tropical rain patter on classroom tin/concrete roof
  private generateRainBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 6.0;
    const totalSamples = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, totalSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    let bL = 0, bR = 0;

    for (let i = 0; i < totalSamples; i++) {
      const whiteL = Math.random() * 2 - 1;
      const whiteR = Math.random() * 2 - 1;

      // Soft 1-pole lowpass for rain wash
      bL = 0.88 * bL + whiteL * 0.12;
      bR = 0.88 * bR + whiteR * 0.12;

      // Occasional random raindrop transient burst
      const isDrop = Math.random() < 0.003;
      const dropL = isDrop ? (Math.random() * 2 - 1) * 0.7 : 0;
      const dropR = isDrop ? (Math.random() * 2 - 1) * 0.7 : 0;

      left[i] = (bL * 0.8 + dropL * 0.35) * 0.6;
      right[i] = (bR * 0.8 + dropR * 0.35) * 0.6;
    }

    return buffer;
  }

  // ── Procedural Passing Vehicle Engine Loop Buffer ───────────
  private generateVehicleEngineBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const duration = 4.0;
    const totalSamples = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
    const data = buffer.getChannelData(0);

    let phase = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      // 45 Hz 2-stroke / 4-stroke thumping cycle with harmonic buzz
      const rpm = 52 + 5 * Math.sin(t * 4);
      phase += rpm / sampleRate;
      if (phase > 1) phase -= 1;

      const cylinderPulse = Math.sin(phase * Math.PI * 2) + 0.5 * Math.sin(phase * Math.PI * 4);
      const exhaustHiss = (Math.random() * 2 - 1) * 0.15;
      data[i] = (cylinderPulse * 0.75 + exhaustHiss) * 0.85;
    }

    return buffer;
  }

  // ── Pre-cached Reverb Impulse Response Bank ─────────────────
  private generateReverbIR(ctx: AudioContext, rt60: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rt60 * sampleRate));
    const irBuffer = ctx.createBuffer(2, length, sampleRate);
    const left = irBuffer.getChannelData(0);
    const right = irBuffer.getChannelData(1);

    const decayRate = 6.907755 / rt60;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const decay = Math.exp(-decayRate * t);
      const earlyFactor = t < 0.06 ? 1.4 : 1.0;
      left[i] = (Math.random() * 2 - 1) * earlyFactor * decay;
      right[i] = (Math.random() * 2 - 1) * earlyFactor * decay;
    }

    return irBuffer;
  }

  private getCachedReverbIR(ctx: AudioContext, rt60: number): AudioBuffer {
    const rounded = Math.round(Math.max(0.3, Math.min(2.5, rt60)) * 10) / 10;
    if (this.irCache.has(rounded)) {
      return this.irCache.get(rounded)!;
    }
    const ir = this.generateReverbIR(ctx, rounded);
    this.irCache.set(rounded, ir);
    return ir;
  }

  // ── Setup DSP Audio Graph ───────────────────────────────────
  private async setupGraph(): Promise<AudioContext> {
    const ctx = await this.ensureContext();

    if (this.masterCompressor && this.masterGain) return ctx;

    if (!this.builtinSpeechBuffer) {
      this.builtinSpeechBuffer = this.generateBuiltinSpeechBuffer(ctx);
    }
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.generateNoiseBuffer(ctx);
    }
    if (!this.rainBuffer) {
      this.rainBuffer = this.generateRainBuffer(ctx);
    }
    // Master Output & Compressor
    this.masterCompressor = ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.setValueAtTime(-6, ctx.currentTime);
    this.masterCompressor.knee.setValueAtTime(10, ctx.currentTime);
    this.masterCompressor.ratio.setValueAtTime(8, ctx.currentTime);
    this.masterCompressor.attack.setValueAtTime(0.005, ctx.currentTime);
    this.masterCompressor.release.setValueAtTime(0.08, ctx.currentTime);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.85, ctx.currentTime);

    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Speech sub-chain
    this.speechFilterNode = ctx.createBiquadFilter();
    this.speechFilterNode.type = 'lowpass';
    this.speechFilterNode.frequency.setValueAtTime(8000, ctx.currentTime);
    this.speechFilterNode.Q.setValueAtTime(0.7, ctx.currentTime);

    this.speechDirectGain = ctx.createGain();
    this.speechDirectGain.gain.setValueAtTime(0.7, ctx.currentTime);

    this.speechRevGain = ctx.createGain();
    this.speechRevGain.gain.setValueAtTime(0.3, ctx.currentTime);

    this.convolverNode = ctx.createConvolver();
    const initialRT60 = this.lastMetrics?.rt60 ?? 1.2;
    this.convolverNode.buffer = this.getCachedReverbIR(ctx, initialRT60);
    this.currentConvolverRT60 = Math.round(initialRT60 * 10) / 10;

    this.speechFilterNode.connect(this.speechDirectGain);
    this.speechDirectGain.connect(this.masterCompressor);

    this.speechFilterNode.connect(this.convolverNode);
    this.convolverNode.connect(this.speechRevGain);
    this.speechRevGain.connect(this.masterCompressor);

    // Ambient Noise sub-chain (steady traffic)
    this.noiseFilterNode = ctx.createBiquadFilter();
    this.noiseFilterNode.type = 'lowpass';
    this.noiseFilterNode.frequency.setValueAtTime(4500, ctx.currentTime);

    this.noiseGainNode = ctx.createGain();
    this.noiseGainNode.gain.setValueAtTime(0.25, ctx.currentTime);

    this.noiseFilterNode.connect(this.noiseGainNode);
    this.noiseGainNode.connect(this.masterCompressor);

    // Rain Layer sub-chain
    this.rainFilterNode = ctx.createBiquadFilter();
    this.rainFilterNode.type = 'bandpass';
    this.rainFilterNode.frequency.setValueAtTime(1200, ctx.currentTime);
    this.rainFilterNode.Q.setValueAtTime(1.2, ctx.currentTime);

    this.rainGainNode = ctx.createGain();
    this.rainGainNode.gain.setValueAtTime(this.isRainActive ? this.rainVolume : 0, ctx.currentTime);

    this.rainFilterNode.connect(this.rainGainNode);
    this.rainGainNode.connect(this.masterCompressor);

    return ctx;
  }

  // ── Start / Stop Playback ────────────────────────────────────
  public async play(): Promise<void> {
    if (this.isPlaying) return;
    if (this.playbackStart) return this.playbackStart;

    const startup = this.startPlayback();
    this.playbackStart = startup;
    try {
      await startup;
    } finally {
      if (this.playbackStart === startup) this.playbackStart = null;
    }
  }

  private async startPlayback(): Promise<void> {
    const ctx = await this.setupGraph();
    if (this.isPlaying) return;

    let activeBuffer: AudioBuffer | null = this.builtinSpeechBuffer;
    if (this.sourceType === 'upload' && this.customUploadBuffer) {
      activeBuffer = this.customUploadBuffer;
    } else if (this.sourceType === 'mic' && this.micRecordingBuffer) {
      activeBuffer = this.micRecordingBuffer;
    }
    if (!activeBuffer) activeBuffer = this.builtinSpeechBuffer;

    this.speechSourceNode = ctx.createBufferSource();
    this.speechSourceNode.buffer = activeBuffer;
    this.speechSourceNode.loop = true;
    this.speechSourceNode.connect(this.speechFilterNode!);
    this.speechSourceNode.start();

    this.noiseSourceNode = ctx.createBufferSource();
    this.noiseSourceNode.buffer = this.noiseBuffer;
    this.noiseSourceNode.loop = true;
    this.noiseSourceNode.connect(this.noiseFilterNode!);
    this.noiseSourceNode.start();

    this.rainSourceNode = ctx.createBufferSource();
    this.rainSourceNode.buffer = this.rainBuffer;
    this.rainSourceNode.loop = true;
    this.rainSourceNode.connect(this.rainFilterNode!);
    this.rainSourceNode.start();

    this.isPlaying = true;

    this.startVehicleScheduler();
    this.startVehicleAnimationLoop();

    if (this.lastRoom) {
      this.updateDSP(this.lastRoom, this.lastMetrics ?? computeAcoustics(this.lastRoom));
    }

    this.notify();
  }

  public stop(): void {
    if (!this.isPlaying) return;

    try {
      this.speechSourceNode?.stop();
      this.speechSourceNode?.disconnect();
      this.noiseSourceNode?.stop();
      this.noiseSourceNode?.disconnect();
      this.rainSourceNode?.stop();
      this.rainSourceNode?.disconnect();
    } catch {
      // Ignored
    }

    this.speechSourceNode = null;
    this.noiseSourceNode = null;
    this.rainSourceNode = null;

    // Despawn and clean up all passing vehicles
    this.clearAllVehicles();
    this.stopVehicleScheduler();

    this.isPlaying = false;
    this.notify();
  }

  // ── Continuous Rain Layer Controls ───────────────────────────
  public toggleRain(): boolean {
    this.isRainActive = !this.isRainActive;
    if (this.rainGainNode && this.ctx) {
      this.rainGainNode.gain.setTargetAtTime(
        this.isRainActive ? this.rainVolume : 0,
        this.ctx.currentTime,
        0.1
      );
    }
    this.notify();
    return this.isRainActive;
  }

  public setRainActive(active: boolean): void {
    this.isRainActive = active;
    if (this.rainGainNode && this.ctx) {
      this.rainGainNode.gain.setTargetAtTime(
        this.isRainActive ? this.rainVolume : 0,
        this.ctx.currentTime,
        0.1
      );
    }
    this.notify();
  }

  public setRainVolume(vol: number): void {
    this.rainVolume = Math.max(0, Math.min(1, vol));
    if (this.isRainActive && this.rainGainNode && this.ctx) {
      this.rainGainNode.gain.setTargetAtTime(this.rainVolume, this.ctx.currentTime, 0.05);
    }
    this.notify();
  }

  // ── Dynamic Moving Spatial Vehicles System ───────────────────
  /**
   * Spawns a moving spatial vehicle (tricycle, motorcycle, or jeepney)
   * that travels along the roadside and plays 3D panned audio.
   */
  public spawnVehicle(forcedType?: VehicleType): ActiveVehicleState | null {
    if (!this.ctx || !this.masterCompressor) return null;

    const ctx = this.ctx;
    if (!this.vehicleEngineBuffer) {
      this.vehicleEngineBuffer = this.generateVehicleEngineBuffer(ctx);
    }
    const types: VehicleType[] = ['tricycle', 'motorcycle', 'jeepney'];
    const chosenType = forcedType || types[Math.floor(Math.random() * types.length)];

    const id = `veh-${this.vehicleIdCounter++}`;
    const labels: Record<VehicleType, string> = {
      tricycle: 'Passing Tricycle',
      motorcycle: 'Motorcycle Rush',
      jeepney: 'Passing Jeepney',
    };
    const dbAs: Record<VehicleType, number> = {
      tricycle: 79,
      motorcycle: 82,
      jeepney: 84,
    };

    // Travel path: along east roadside (x ≈ 11.5m), from y = -6m to y = 14m
    const startX = 11.5;
    const startY = -6.0;
    const endX = 11.5;
    const endY = 14.0;
    const speed = chosenType === 'motorcycle' ? 12 : chosenType === 'tricycle' ? 7.5 : 9.0; // m/s
    const totalDist = Math.hypot(endX - startX, endY - startY);
    const duration = totalDist / speed; // seconds

    // Audio DSP chain for passing vehicle
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = this.vehicleEngineBuffer;
    sourceNode.loop = true;

    // Pitch modulate based on vehicle type
    sourceNode.playbackRate.value =
      chosenType === 'motorcycle' ? 1.4 : chosenType === 'tricycle' ? 1.0 : 0.75;

    // Spatial Panner
    const pannerNode = ctx.createStereoPanner();
    pannerNode.pan.setValueAtTime(0.7, ctx.currentTime); // Starts on right side

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(3200, ctx.currentTime);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);

    // Routing
    sourceNode.connect(filterNode);
    filterNode.connect(pannerNode);
    pannerNode.connect(gainNode);
    gainNode.connect(this.masterCompressor);

    sourceNode.start();

    const vehicleInstance: ActiveVehicleAudioNode = {
      state: {
        id,
        type: chosenType,
        label: labels[chosenType],
        x: startX,
        y: startY,
        speed,
        dbA: dbAs[chosenType],
        progress: 0,
      },
      sourceNode,
      pannerNode,
      gainNode,
      filterNode,
      startX,
      startY,
      endX,
      endY,
      startTime: ctx.currentTime,
      duration,
    };

    this.activeVehicles.push(vehicleInstance);
    this.notify();

    return vehicleInstance.state;
  }

  private startVehicleScheduler() {
    this.stopVehicleScheduler();
    const scheduleNext = () => {
      // Randomized interval between 12 and 22 seconds
      const delayMs = 12000 + Math.random() * 10000;
      this.vehicleIntervalTimer = window.setTimeout(() => {
        if (this.isPlaying) {
          this.spawnVehicle();
          scheduleNext();
        }
      }, delayMs);
    };
    scheduleNext();
  }

  private stopVehicleScheduler() {
    if (this.vehicleIntervalTimer) {
      clearTimeout(this.vehicleIntervalTimer);
      this.vehicleIntervalTimer = null;
    }
  }

  private startVehicleAnimationLoop() {
    if (this.vehicleAnimRaf) cancelAnimationFrame(this.vehicleAnimRaf);

    const tick = () => {
      if (!this.isPlaying || !this.ctx) {
        this.vehicleAnimRaf = null;
        return;
      }

      const now = this.ctx.currentTime;
      const room = this.isABBaseline ? PRESET_HIGHWAY_CONCRETE : this.lastRoom || PRESET_HIGHWAY_CONCRETE;
      const listener = room.activeListener;
      let didDespawn = false;

      // Find east wall transmission loss
      const eastWall = room.wallSegments.find((w) => w.id === 'wall-east');
      const wallTL = eastWall?.material === 'open_window' ? 2 : eastWall?.material === 'curtained_window' ? 9 : 28;

      for (let i = this.activeVehicles.length - 1; i >= 0; i--) {
        const v = this.activeVehicles[i];
        const elapsed = now - v.startTime;
        const progress = Math.min(1.0, elapsed / v.duration);

        v.state.progress = progress;
        v.state.x = v.startX + (v.endX - v.startX) * progress;
        v.state.y = v.startY + (v.endY - v.startY) * progress;

        // 3D Spatial Audio Pan & Attenuation
        const dx = v.state.x - listener.x;
        const dy = v.state.y - listener.y;
        const dist = Math.max(1.0, Math.hypot(dx, dy));

        // Stereo pan: -1 (left) to +1 (right)
        const pan = Math.max(-1, Math.min(1, dx / Math.max(dist, 1)));
        v.pannerNode.pan.setTargetAtTime(pan, now, 0.04);

        // Distance attenuation + wall insertion loss
        const spl = v.state.dbA - 20 * Math.log10(dist) - wallTL;
        const linGain = Math.pow(10, (spl - 65) / 20) * 0.45;
        v.gainNode.gain.setTargetAtTime(Math.max(0.001, linGain), now, 0.04);

        // Doppler pitch shift
        const approachVelocity = ((listener.y - v.state.y) / dist) * v.state.speed;
        const dopplerRatio = Math.max(0.85, Math.min(1.18, (343 + approachVelocity) / 343));
        const baseRate = v.state.type === 'motorcycle' ? 1.4 : v.state.type === 'tricycle' ? 1.0 : 0.75;
        v.sourceNode.playbackRate.setTargetAtTime(baseRate * dopplerRatio, now, 0.05);

        // Despawn once finished
        if (progress >= 1.0) {
          try {
            v.sourceNode.stop();
            v.sourceNode.disconnect();
            v.gainNode.disconnect();
          } catch {
            // Ignored
          }
          this.activeVehicles.splice(i, 1);
          didDespawn = true;
        }
      }

      if (didDespawn || now - this.lastVehicleNotifyTime >= 0.1) {
        this.lastVehicleNotifyTime = now;
        this.notify();
      }

      this.vehicleAnimRaf = requestAnimationFrame(tick);
    };

    this.vehicleAnimRaf = requestAnimationFrame(tick);
  }

  private clearAllVehicles() {
    for (const v of this.activeVehicles) {
      try {
        v.sourceNode.stop();
        v.sourceNode.disconnect();
        v.gainNode.disconnect();
      } catch {
        // Ignored
      }
    }
    this.activeVehicles = [];
    if (this.vehicleAnimRaf) {
      cancelAnimationFrame(this.vehicleAnimRaf);
      this.vehicleAnimRaf = null;
    }
  }

  // ── Source Selection & Compare Controls ───────────────────────
  public async setSourceType(type: AudioSourceType): Promise<void> {
    if (this.sourceType === type) return;
    this.sourceType = type;
    if (this.isPlaying) {
      this.stop();
      await this.play();
    } else {
      this.notify();
    }
  }

  public toggleABCompare(): boolean {
    this.isABBaseline = !this.isABBaseline;
    if (this.lastRoom) {
      this.updateDSP(this.lastRoom, this.lastMetrics ?? computeAcoustics(this.lastRoom));
    }
    this.notify();
    return this.isABBaseline;
  }

  public setABBaseline(isBaseline: boolean) {
    this.isABBaseline = isBaseline;
    if (this.lastRoom) {
      this.updateDSP(this.lastRoom, this.lastMetrics ?? computeAcoustics(this.lastRoom));
    }
    this.notify();
  }

  public async loadUserAudioFile(file: File): Promise<boolean> {
    try {
      const ctx = await this.ensureContext();
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      this.customUploadBuffer = decoded;
      this.sourceType = 'upload';
      if (this.isPlaying) {
        this.stop();
        await this.play();
      } else {
        this.notify();
      }
      return true;
    } catch (err) {
      console.error('Failed to decode custom audio file:', err);
      return false;
    }
  }

  public async startMicrophoneRecording(onCountdown?: (sec: number) => void): Promise<boolean> {
    try {
      if (this.isPlaying) this.stop();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micStream = stream;
      this.recordedChunks = [];

      // Cross-browser supported MIME type detection (Safari requires mp4/aac, Chrome supports webm)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(this.recordedChunks, { type: mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const ctx = await this.ensureContext();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          this.micRecordingBuffer = audioBuffer;
          this.sourceType = 'mic';
          this.notify();
        } catch (e) {
          console.error('Failed to decode mic recording:', e);
        } finally {
          this.micStream?.getTracks().forEach((track) => track.stop());
          this.micStream = null;
          this.mediaRecorder = null;
          this.notify();
        }
      };

      recorder.start();
      this.notify();

      let remaining = 5;
      if (onCountdown) onCountdown(remaining);

      this.recordingInterval = window.setInterval(() => {
        remaining -= 1;
        if (onCountdown) onCountdown(remaining);
        if (remaining <= 0) {
          if (this.recordingInterval !== null) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
          }
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
          }
        }
      }, 1000);

      return true;
    } catch (err) {
      if (this.recordingInterval !== null) {
        clearInterval(this.recordingInterval);
        this.recordingInterval = null;
      }
      this.micStream?.getTracks().forEach((track) => track.stop());
      this.micStream = null;
      this.mediaRecorder = null;
      this.notify();
      console.error('Microphone access denied or unsupported:', err);
      return false;
    }
  }

  // ── Dynamic Live DSP Update ─────────────────────────────────
  public updateDSP(room: RoomState, metrics: AcousticMetrics) {
    this.lastRoom = room;
    this.lastMetrics = metrics;

    if (!this.ctx || !this.isPlaying) return;

    const ctx = this.ctx;
    const dspRoom = this.isABBaseline ? PRESET_HIGHWAY_CONCRETE : room;
    const now = ctx.currentTime;

    let effectiveRT60 = metrics.rt60;
    let effectiveSpeechLevel = metrics.speechLevel;
    let effectiveNoiseLevel = metrics.noiseLevel;

    if (this.isABBaseline) {
      effectiveRT60 = BASELINE_METRICS.rt60;
      effectiveSpeechLevel = BASELINE_METRICS.speechLevel;
      effectiveNoiseLevel = BASELINE_METRICS.noiseLevel;
    }

    // 1. Instant smooth convolver IR retrieval from prewarmed cache
    const roundedRT = Math.round(effectiveRT60 * 10) / 10;
    if (this.convolverNode && Math.abs(roundedRT - this.currentConvolverRT60) >= 0.1) {
      this.convolverNode.buffer = this.getCachedReverbIR(ctx, roundedRT);
      this.currentConvolverRT60 = roundedRT;
    }

    // 2. Speech Filter: Consonant smear based on RT60 and orientation
    const angleToListener = Math.atan2(
      dspRoom.activeListener.y - dspRoom.teacher.y,
      dspRoom.activeListener.x - dspRoom.teacher.x
    );
    const relAngle = Math.abs(
      ((dspRoom.teacher.angle - angleToListener + Math.PI) % (Math.PI * 2)) - Math.PI
    );
    const offAxisMuffle = 1.0 - (relAngle / Math.PI) * 0.45;

    const rtSmear = Math.max(0, Math.min(1, (effectiveRT60 - 0.4) / 1.4));
    const targetCutoff = Math.max(1800, (9000 - rtSmear * 6200) * offAxisMuffle);

    if (this.speechFilterNode) {
      this.speechFilterNode.frequency.setTargetAtTime(targetCutoff, now, 0.05);
    }

    // 3. Direct vs Reverberant Speech Gain
    const speechLin = Math.pow(10, (effectiveSpeechLevel - 65) / 20) * 0.55;
    const revRatio = Math.min(0.85, 0.2 + (effectiveRT60 / 2.0) * 0.65);
    const directRatio = Math.max(0.15, 1.0 - revRatio * 0.8);

    if (this.speechDirectGain) {
      this.speechDirectGain.gain.setTargetAtTime(
        Math.max(0.01, speechLin * directRatio),
        now,
        0.05
      );
    }
    if (this.speechRevGain) {
      this.speechRevGain.gain.setTargetAtTime(
        Math.max(0.01, speechLin * revRatio),
        now,
        0.05
      );
    }

    // 4. Infiltrated Steady Traffic Noise Gain
    const noiseLin = Math.pow(10, (effectiveNoiseLevel - 65) / 20) * 0.55;
    if (this.noiseGainNode) {
      this.noiseGainNode.gain.setTargetAtTime(
        Math.max(0.001, noiseLin),
        now,
        0.05
      );
    }

    // 5. Rain Layer Level Modulation: penetrations through open/curtained windows
    if (this.rainFilterNode && this.rainGainNode) {
      const eastWall = dspRoom.wallSegments.find((w) => w.id === 'wall-east');
      const rainAtten = eastWall?.material === 'open_window' ? 1.0 : eastWall?.material === 'curtained_window' ? 0.6 : 0.25;
      if (this.isRainActive) {
        this.rainGainNode.gain.setTargetAtTime(this.rainVolume * rainAtten, now, 0.05);
      }
    }
  }
}

// Singleton audio engine instance
export const audioEngine = new AudioAuralizationEngine();
