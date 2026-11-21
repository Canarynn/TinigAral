// ============================================================
// TinigAral — MetricsPanel.tsx
// Right-panel live acoustic metric cards, Audio Auralization Deck,
// Smart Diagnosis & Recommendations, and Before/After Delta badges
// ============================================================

import React, { useMemo } from 'react';
import {
  Activity,
  Volume2,
  VolumeX,
  Mic2,
  Zap,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Layers,
} from 'lucide-react';
import type { RoomState } from '../types/room';
import { computeAcoustics, type AcousticMetrics, INTELLIGIBILITY_COLOR } from '../engine/acoustics';
import { PRESETS, type PresetKey } from '../data/presets';
import { AudioDeck } from './AudioDeck';
import { DiagnosisBox } from './DiagnosisBox';

interface MetricsPanelProps {
  room: RoomState;
  activePreset: PresetKey | null;
  onPresetSelect: (key: PresetKey) => void;
  onRoomChange: (room: RoomState) => void;
  baselineMetrics?: AcousticMetrics | null;
  baselineLabel?: string;
  isABBaselineActive?: boolean;
  onABToggle?: (isBaseline: boolean) => void;
}

// ── Colour helpers ────────────────────────────────────────────
function rt60Color(rt: number): string {
  if (rt < 0.6)  return '#34d399'; // emerald — treated
  if (rt < 1.0)  return '#fbbf24'; // amber   — moderate
  return '#fb7185';                // rose    — excessive
}

function snrColor(snr: number): string {
  if (snr >= 15) return '#34d399';
  if (snr >= 5)  return '#fbbf24';
  return '#fb7185';
}

function levelColor(db: number, isSpeech: boolean): string {
  if (isSpeech) {
    if (db >= 55) return '#34d399';
    if (db >= 48) return '#fbbf24';
    return '#fb7185';
  } else {
    if (db <= 45) return '#34d399';
    if (db <= 55) return '#fbbf24';
    return '#fb7185';
  }
}

// ── Status icon ───────────────────────────────────────────────
function StatusIcon({ status }: { status: AcousticMetrics['intelligibilityStatus'] }) {
  if (status === 'Optimal')  return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === 'Strained') return <AlertTriangle size={14} className="text-amber-400" />;
  return <XCircle size={14} className="text-rose-400" />;
}

// ── Single metric card ────────────────────────────────────────
interface MetricCardProps {
  icon:        React.ReactNode;
  label:       string;
  value:       string;
  unit:        string;
  color:       string;
  subtext?:    string;
  barPercent?: number;   // 0–100 for progress bar
  barColor?:   string;
  tooltip?:    string;
  deltaBadge?: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon, label, value, unit, color, subtext, barPercent, barColor, tooltip, deltaBadge,
}) => (
  <div className="metric-card group" title={tooltip}>
    {/* Top row */}
    <div className="flex items-start justify-between mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className="p-1 rounded bg-white/5">{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        {deltaBadge}
        {tooltip && (
          <Info size={11} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>

    {/* Value */}
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <span className="text-xl font-bold font-mono tracking-tight" style={{ color }}>
        {value}
      </span>
      <span className="text-[11px] text-slate-500 font-medium">{unit}</span>
    </div>

    {/* Progress bar */}
    {barPercent !== undefined && (
      <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden mb-1.5">
        <div
          className="progress-fill"
          style={{
            width:      `${Math.min(100, Math.max(0, barPercent))}%`,
            background: barColor ?? color,
          }}
        />
      </div>
    )}

    {/* Sub-text */}
    {subtext && (
      <p className="text-[10px] text-slate-500 leading-snug">{subtext}</p>
    )}
  </div>
);

// ── Main panel ────────────────────────────────────────────────
const MetricsPanel: React.FC<MetricsPanelProps> = ({
  room,
  activePreset,
  onPresetSelect,
  onRoomChange,
  baselineMetrics,
  baselineLabel = 'Untreated Baseline',
  isABBaselineActive,
  onABToggle,
}) => {
  // Compute acoustic physics metrics
  const m: AcousticMetrics = useMemo(() => computeAcoustics(room), [room]);

  const statusBadgeClass =
    m.intelligibilityStatus === 'Optimal'  ? 'badge-optimal'  :
    m.intelligibilityStatus === 'Strained' ? 'badge-strained' :
                                              'badge-critical';

  const statusColor = INTELLIGIBILITY_COLOR[m.intelligibilityStatus];

  // Calculate Comparison Deltas against baseline
  const scoreDelta = baselineMetrics
    ? Math.round(m.intelligibilityScore - baselineMetrics.intelligibilityScore)
    : null;

  const rt60Delta = baselineMetrics
    ? Number((m.rt60 - baselineMetrics.rt60).toFixed(2))
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto gap-3 p-3.5 pr-2.5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-1 border-b border-white/5">
        <div>
          <h2 className="text-xs font-bold text-white tracking-wide uppercase flex items-center gap-1.5">
            <Layers size={13} className="text-accent-400" />
            Classroom Acoustic Dashboard
          </h2>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Active Listener @ ({room.activeListener.x.toFixed(1)}m, {room.activeListener.y.toFixed(1)}m)
          </p>
        </div>
        <span className={statusBadgeClass}>
          <StatusIcon status={m.intelligibilityStatus} />
          {m.intelligibilityStatus}
        </span>
      </div>

      {/* ── 1. Hero Intelligibility Score Card with Deltas ── */}
      {isABBaselineActive && (
        <div className="py-1 px-2.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] font-semibold flex items-center justify-between animate-pulse flex-shrink-0">
          <span>A/B Compare: Baseline Audio & DSP Active</span>
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20">Bare Concrete</span>
        </div>
      )}
      <div
        className="metric-card border-accent-500/30 bg-gradient-to-b from-surface-800 to-surface-850 p-4 min-h-[145px] flex-shrink-0 flex flex-col justify-between"
        style={{ borderColor: `${statusColor}50` }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="p-1 rounded-md bg-white/5">
              <Zap size={14} style={{ color: statusColor }} />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              Speech Intelligibility Score
            </span>
          </div>

          <span className={statusBadgeClass}>
            <StatusIcon status={m.intelligibilityStatus} />
            {m.intelligibilityStatus}
          </span>
        </div>

        {/* Big Score + Comparison Delta Badges */}
        <div className="flex items-center justify-between my-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-5xl font-black font-mono tracking-tight leading-tight"
              style={{ color: statusColor }}
            >
              {Math.round(m.intelligibilityScore)}
            </span>
            <span className="text-base text-slate-400 font-bold pb-0.5">/ 100</span>
          </div>

          {/* Delta badge when compared against baseline */}
          {scoreDelta !== null && scoreDelta !== 0 && (
            <div className="flex flex-col items-end">
              <span
                className={[
                  'inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border shadow-sm',
                  scoreDelta > 0
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border-rose-500/30',
                ].join(' ')}
              >
                {scoreDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {scoreDelta > 0 ? `+${scoreDelta}%` : `${scoreDelta}%`}
              </span>
              <span className="text-[9px] text-slate-400 mt-0.5">vs {baselineLabel}</span>
            </div>
          )}
        </div>

        {/* Segmented gauge bar */}
        <div className="flex gap-1 h-2.5 my-2 rounded-full overflow-hidden bg-black/40 p-0.5 border border-white/10">
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-300"
              style={{
                background: i < Math.round(m.intelligibilityScore / 5)
                  ? statusColor
                  : 'rgba(255,255,255,0.06)',
                boxShadow: i < Math.round(m.intelligibilityScore / 5)
                  ? `0 0 6px ${statusColor}80`
                  : 'none',
              }}
            />
          ))}
        </div>

        <p className="text-[10px] text-slate-400 leading-normal">
          Model: SNR ({m.snr >= 0 ? '+' : ''}{m.snr.toFixed(1)} dB) penalised by RT₆₀ echo smear ({m.rt60.toFixed(2)}s).
          Room absorption: {m.totalAbsorption.toFixed(1)} Sabins.
        </p>
      </div>

      {/* ── 2. Live Audio Auralization Deck ── */}
      <AudioDeck
        room={room}
        metrics={m}
        onABToggle={onABToggle}
      />

      {/* ── 3. Smart Acoustic Diagnosis & Recommendation Box ── */}
      <DiagnosisBox
        room={room}
        metrics={m}
        onApplyFix={onRoomChange}
      />

      {/* ── 4. Key Metric Cards Grid ── */}
      <div className="grid grid-cols-2 gap-2 flex-shrink-0">
        {/* RT60 */}
        <MetricCard
          icon={<Activity size={12} style={{ color: rt60Color(m.rt60) }} />}
          label="Reverberation"
          value={m.rt60.toFixed(2)}
          unit="s (RT₆₀)"
          color={rt60Color(m.rt60)}
          barPercent={(m.rt60 / 2.2) * 100}
          barColor={rt60Color(m.rt60)}
          subtext={m.rt60 < 0.6 ? 'Target met (<0.6s)' : 'Excessive echo'}
          tooltip="Sabine RT₆₀ = 0.161 × V / A. Target: 0.45s–0.65s."
          deltaBadge={
            rt60Delta !== null && rt60Delta !== 0 ? (
              <span
                className={[
                  'text-[9px] font-mono font-bold px-1 rounded',
                  rt60Delta < 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10',
                ].join(' ')}
              >
                {rt60Delta > 0 ? `+${rt60Delta}s` : `${rt60Delta}s`}
              </span>
            ) : null
          }
        />

        {/* SNR */}
        <MetricCard
          icon={<VolumeX size={12} style={{ color: snrColor(m.snr) }} />}
          label="Signal / Noise"
          value={(m.snr >= 0 ? '+' : '') + m.snr.toFixed(1)}
          unit="dB"
          color={snrColor(m.snr)}
          barPercent={((m.snr + 10) / 30) * 100}
          barColor={snrColor(m.snr)}
          subtext={m.snr >= 15 ? 'Excellent margin' : m.snr >= 5 ? 'Strained' : 'Critical loss'}
          tooltip="SNR = Speech dBA − Noise dBA. DepEd & WHO target: ≥ +15 dB."
        />

        {/* Speech Level */}
        <MetricCard
          icon={<Mic2 size={12} style={{ color: levelColor(m.speechLevel, true) }} />}
          label="Speech Level"
          value={m.speechLevel.toFixed(1)}
          unit="dBA"
          color={levelColor(m.speechLevel, true)}
          barPercent={((m.speechLevel - 35) / 40) * 100}
          subtext="Direct + diffuse field"
          tooltip="Speech decay from 65 dBA@1m with orientation factor + reverberant buildup."
        />

        {/* Infiltrated Noise */}
        <MetricCard
          icon={<Volume2 size={12} style={{ color: levelColor(m.noiseLevel, false) }} />}
          label="Noise Infiltration"
          value={m.noiseLevel.toFixed(1)}
          unit="dBA"
          color={levelColor(m.noiseLevel, false)}
          barPercent={((m.noiseLevel - 20) / 60) * 100}
          subtext={`${room.noiseSources.length} external source(s)`}
          tooltip="Combined sum of external traffic/fan noise attenuated by window/wall transmission loss."
        />
      </div>

      {/* ── 5. Presets Selector ── */}
      <div className="pt-1 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Preset Scenarios
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <div className="flex flex-col gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => onPresetSelect(preset.key)}
              className={['preset-btn py-2 px-3', activePreset === preset.key ? 'active' : ''].join(' ')}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{preset.label}</span>
                <ChevronRight
                  size={13}
                  className={activePreset === preset.key ? 'text-accent-400' : 'text-slate-600'}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Footer Quick Hint ── */}
      <div className="flex items-center gap-1.5 text-[9px] text-slate-500 px-1 pt-1 mt-auto">
        <RefreshCw size={9} />
        <span>Click walls to cycle material • Drag Teacher/Listener/Noise</span>
      </div>
    </div>
  );
};

export default MetricsPanel;
