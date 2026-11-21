// ============================================================
// DINIG — AudioDeck.tsx
// Audio Auralization Deck: Web Audio DSP controls, A/B toggle,
// procedural synthesizer, custom upload, mic recording,
// continuous rain layer, and dynamic moving spatial vehicles
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Mic,
  Upload,
  Volume2,
  Sparkles,
  Sliders,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  CloudRain,
  Car,
} from 'lucide-react';
import {
  audioEngine,
  type AudioEngineState,
  type AudioSourceType,
  type VehicleType,
} from '../engine/audioEngine';
import type { RoomState } from '../types/room';
import { computeAcoustics, type AcousticMetrics } from '../engine/acoustics';
import { PRESET_HIGHWAY_CONCRETE } from '../data/presets';

const baselineMetrics = computeAcoustics(PRESET_HIGHWAY_CONCRETE);

interface AudioDeckProps {
  room: RoomState;
  metrics: AcousticMetrics;
  onABToggle?: (isBaseline: boolean) => void;
}

export const AudioDeck: React.FC<AudioDeckProps> = ({ room, metrics, onABToggle }) => {
  const [engineState, setEngineState] = useState<AudioEngineState>(audioEngine.getState());
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [isLoadingUpload, setIsLoadingUpload] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selectedVehicleType, setSelectedVehicleType] = useState<VehicleType | 'random'>('random');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subscribe to engine state updates
  useEffect(() => {
    const unsubscribe = audioEngine.subscribe((s) => {
      setEngineState(s);
    });
    return () => unsubscribe();
  }, []);

  // Push live acoustic metrics & room geometry to audio DSP engine whenever they change
  useEffect(() => {
    audioEngine.updateDSP(room, metrics);
  }, [room, metrics]);

  // Handle Play/Stop
  const togglePlay = async () => {
    if (engineState.isPlaying) {
      audioEngine.stop();
      setAudioError(null);
    } else {
      setIsStartingPlayback(true);
      try {
        await audioEngine.play();
        setAudioError(null);
      } catch {
        setAudioError('Audio could not start. Check browser audio support and try again.');
      } finally {
        setIsStartingPlayback(false);
      }
    }
  };

  // Handle source switch
  const handleSourceSelect = async (type: AudioSourceType) => {
    if (type === 'upload' && !engineState.hasCustomUpload) {
      fileInputRef.current?.click();
      return;
    }
    try {
      await audioEngine.setSourceType(type);
      setAudioError(null);
    } catch {
      setAudioError('The selected audio source could not be started.');
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingUpload(true);
    setAudioError(null);
    try {
      const loaded = await audioEngine.loadUserAudioFile(file);
      if (loaded) {
        setUploadFileName(file.name);
        setAudioError(null);
      } else {
        setAudioError('This audio file could not be decoded. Choose another supported file.');
      }
    } finally {
      setIsLoadingUpload(false);
      e.target.value = '';
    }
  };

  // Handle microphone 5s recording
  const handleRecordMic = async () => {
    if (engineState.isRecording) return;
    setIsRequestingMic(true);
    try {
      const started = await audioEngine.startMicrophoneRecording((sec) => {
        if (sec <= 0) {
          setRecordingCountdown(null);
        } else {
          setRecordingCountdown(sec);
        }
      });
      if (started) {
        setAudioError(null);
      } else {
        setRecordingCountdown(null);
        setAudioError('Microphone access was denied or is unavailable. Check browser permissions.');
      }
    } catch {
      setRecordingCountdown(null);
      setAudioError('Microphone recording could not start. Check browser permissions.');
    } finally {
      setIsRequestingMic(false);
    }
  };

  // Handle A/B compare toggle
  const handleABToggle = () => {
    const nextBaseline = audioEngine.toggleABCompare();
    if (onABToggle) onABToggle(nextBaseline);
  };

  // Handle Rain Layer Toggle & Volume
  const handleToggleRain = () => {
    audioEngine.toggleRain();
  };

  const handleRainVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    audioEngine.setRainVolume(val);
  };

  // Handle Dynamic Vehicle Spawn
  const handleSpawnVehicle = async () => {
    const shouldStartPlayback = !engineState.isPlaying;
    if (shouldStartPlayback) setIsStartingPlayback(true);
    try {
      if (shouldStartPlayback) {
        await audioEngine.play();
      }
      const type = selectedVehicleType === 'random' ? undefined : selectedVehicleType;
      if (!audioEngine.spawnVehicle(type)) {
        setAudioError('The vehicle sound could not be created. Start audio and try again.');
      } else {
        setAudioError(null);
      }
    } catch {
      setAudioError('Audio could not start. Check browser audio support and try again.');
    } finally {
      if (shouldStartPlayback) setIsStartingPlayback(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-surface-800/90 p-3.5 backdrop-blur shadow-xl transition-all duration-300">
      {/* ── Deck Header ── */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-2 select-none group"
        >
          <div className="p-1.5 rounded-lg bg-accent-500/10 text-accent-400 group-hover:bg-accent-500/20 transition-colors">
            <Sliders size={14} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
              Live Acoustic Auralization
              {engineState.isPlaying && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
            </h3>
            <p className="text-[10px] text-slate-400">Hear the simulated room in real-time</p>
          </div>
          <button
            type="button"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand audio controls' : 'Collapse audio controls'}
            className="text-slate-500 hover:text-slate-300 ml-1 p-0.5 rounded transition-colors"
            title={isCollapsed ? 'Expand audio controls' : 'Collapse audio controls'}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        {/* Master Play/Stop Button */}
        <button
          onClick={togglePlay}
          disabled={isStartingPlayback}
          aria-pressed={engineState.isPlaying}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 shadow-md',
            engineState.isPlaying
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-accent-500 text-surface-950 hover:bg-accent-400 active:scale-95 shadow-glow-teal',
          ].join(' ')}
        >
          {engineState.isPlaying ? (
            <>
              <Square size={13} className="fill-current" />
              <span>Stop Audio</span>
            </>
          ) : (
            <>
              <Play size={13} className="fill-current" />
              <span>{isStartingPlayback ? 'Starting...' : 'Listen Live'}</span>
            </>
          )}
        </button>
      </div>

      {audioError && (
        <p role="alert" className="mt-2 text-[10px] text-rose-300">
          {audioError}
        </p>
      )}

      {/* ── Collapsible Body ── */}
      {!isCollapsed && (
        <div id="audio-deck-controls" className="mt-3 flex flex-col gap-2.5">
          {/* ── Audio Source Selector Tabs ── */}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
              Teacher Speech Source
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-surface-900 border border-white/5">
              {/* Built-in Sample */}
              <button
                onClick={() => handleSourceSelect('builtin')}
                aria-pressed={engineState.sourceType === 'builtin'}
                className={[
                  'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all',
                  engineState.sourceType === 'builtin'
                    ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                ].join(' ')}
                title="Procedural continuous teacher speech loop"
              >
                <Sparkles size={11} />
                <span>Synthesizer</span>
              </button>

              {/* Upload Audio File */}
              <button
                disabled={isLoadingUpload}
                onClick={() => {
                  if (!engineState.hasCustomUpload) {
                    fileInputRef.current?.click();
                  } else {
                    handleSourceSelect('upload');
                  }
                }}
                aria-pressed={engineState.sourceType === 'upload'}
                className={[
                  'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all relative',
                  engineState.sourceType === 'upload'
                    ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                ].join(' ')}
                title={uploadFileName ? `Loaded: ${uploadFileName}` : 'Upload custom .mp3 or .wav speech sample'}
              >
                <Upload size={11} />
                <span className="truncate">{isLoadingUpload ? 'Loading...' : uploadFileName ? 'Custom File' : 'Upload File'}</span>
                {engineState.hasCustomUpload && (
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-400 absolute top-1 right-1" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/mp3,audio/wav,audio/ogg,audio/m4a,audio/*"
                className="hidden"
                onChange={handleFileUpload}
              />

              {/* Microphone Recording */}
              <button
                onClick={handleRecordMic}
                disabled={recordingCountdown !== null || isRequestingMic}
                aria-pressed={engineState.sourceType === 'mic'}
                className={[
                  'flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all relative',
                  recordingCountdown !== null || isRequestingMic
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse font-bold'
                    : engineState.sourceType === 'mic'
                    ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                ].join(' ')}
                title="Record a 5-second voice sample from your microphone"
              >
                <Mic size={11} className={recordingCountdown !== null ? 'animate-bounce text-rose-400' : ''} />
                <span>
                  {isRequestingMic ? 'Allow Mic...' : recordingCountdown !== null ? `Rec ${recordingCountdown}s` : engineState.hasMicRecording ? 'My Voice' : 'Record Mic'}
                </span>
                {engineState.hasMicRecording && recordingCountdown === null && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
                )}
              </button>
            </div>
          </div>

          {/* ── Ambient Audio System: Continuous Rain & Dynamic Vehicles ── */}
          <div className="rounded-lg border border-white/5 bg-surface-900/90 p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <CloudRain size={12} className="text-sky-400" />
                Continuous Rain Layer
              </span>
              <button
                onClick={handleToggleRain}
                aria-pressed={engineState.isRainActive}
                className={[
                  'px-2 py-0.5 rounded text-[10px] font-bold border transition-all flex items-center gap-1',
                  engineState.isRainActive
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-white',
                ].join(' ')}
              >
                {engineState.isRainActive ? 'Rain Active' : 'Rain Off'}
              </button>
            </div>

            {engineState.isRainActive && (
              <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap">Intensity:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={engineState.rainVolume}
                  onChange={handleRainVolumeChange}
                  className="w-full h-1 bg-surface-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
                />
                <span className="text-[9px] font-mono text-sky-400 w-8 text-right">
                  {Math.round(engineState.rainVolume * 100)}%
                </span>
              </div>
            )}

            {/* Dynamic Moving Vehicles */}
            <div className="pt-2 border-t border-white/5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Car size={12} className="text-amber-400" />
                  Roadside Spatial Traffic
                </span>
                <button
                  onClick={handleSpawnVehicle}
                  disabled={isStartingPlayback}
                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all flex items-center gap-1 active:scale-95"
                  title="Trigger a moving vehicle along the east roadside"
                >
                  <span>+ Spawn Vehicle</span>
                </button>
              </div>

              {/* Vehicle selector pills */}
              <div className="flex items-center gap-1">
                {(['random', 'tricycle', 'motorcycle', 'jeepney'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedVehicleType(type)}
                    aria-pressed={selectedVehicleType === type}
                    className={[
                      'flex-1 py-0.5 rounded text-[9px] font-medium transition-all text-center border',
                      selectedVehicleType === type
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 font-semibold'
                        : 'bg-white/5 text-slate-400 border-white/5 hover:text-slate-300',
                    ].join(' ')}
                  >
                    {type === 'random' ? '🎲 Random' : type === 'tricycle' ? '🛺 Tricycle' : type === 'motorcycle' ? '🏍️ Motor' : '🚗 Jeepney'}
                  </button>
                ))}
              </div>

              {/* Active Vehicles Live Readout */}
              {engineState.activeVehicles.length > 0 && (
                <div className="flex flex-col gap-1 mt-1">
                  {engineState.activeVehicles.map((v) => (
                    <div
                      key={v.id}
                      className="px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] text-amber-300 flex items-center justify-between"
                    >
                      <span className="font-semibold flex items-center gap-1">
                        {v.type === 'motorcycle' ? '🏍️' : v.type === 'tricycle' ? '🛺' : '🚗'}
                        {v.label} ({v.dbA} dB)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1 bg-surface-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400 transition-all duration-75"
                            style={{ width: `${Math.round(v.progress * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[8px] text-slate-400">
                          {Math.round(v.progress * 100)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── A/B Instant Compare Toggle ── */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-surface-900/80 border border-white/5">
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                A/B Instant Compare
                {engineState.isABBaseline ? (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    Baseline Active (Bare Concrete)
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-500/20 text-accent-400 border border-accent-500/30">
                    Live Room DSP Active
                  </span>
                )}
              </span>
              <span className="text-[9px] text-slate-400">
                {engineState.isABBaseline
                  ? 'Comparing against untreated highway-side room (RT₆₀ 1.62s)'
                  : 'Listening with your real-time room acoustic configuration'}
              </span>
            </div>

            <button
              onClick={handleABToggle}
              aria-pressed={engineState.isABBaseline}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all',
                engineState.isABBaseline
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-surface-700 text-slate-300 hover:text-white border border-white/10',
              ].join(' ')}
              title="Toggle instant A/B switch between current room acoustics and untreated baseline"
            >
              {engineState.isABBaseline ? (
                <>
                  <ToggleRight size={16} className="text-amber-400" />
                  <span>A/B ON</span>
                </>
              ) : (
                <>
                  <ToggleLeft size={16} className="text-slate-500" />
                  <span>A/B OFF</span>
                </>
              )}
            </button>
          </div>

          {/* ── DSP Status Readout ── */}
          <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400">
            <div className="flex items-center gap-1">
              <Volume2 size={11} className="text-accent-400" />
              <span>IR Reverb:</span>
              <span className="font-mono text-slate-200">
                {engineState.isABBaseline ? `${baselineMetrics.rt60.toFixed(2)}s` : `${metrics.rt60.toFixed(2)}s`}
              </span>
            </div>
            <div>
              <span>Speech / Noise:</span>{' '}
              <span className="font-mono text-slate-200">
                {engineState.isABBaseline
                  ? `${baselineMetrics.speechLevel.toFixed(1)} / ${baselineMetrics.noiseLevel.toFixed(1)} dBA`
                  : `${metrics.speechLevel.toFixed(1)} / ${metrics.noiseLevel.toFixed(1)} dBA`}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span>Mode:</span>
              <span className="font-semibold text-accent-400">
                {engineState.sourceType === 'builtin'
                  ? 'Synthesizer'
                  : engineState.sourceType === 'upload'
                  ? 'Custom File'
                  : 'Voice Clip'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioDeck;
