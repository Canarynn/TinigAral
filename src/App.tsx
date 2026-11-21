// ============================================================
// DINIG — App.tsx
// Root shell: 65% 2.5D Canvas | 35% Live Acoustic & DSP Panel
// ============================================================

import { useState, useCallback, useMemo } from 'react';
import ClassroomCanvas from './components/ClassroomCanvas';
import CanvasToolbar   from './components/CanvasToolbar';
import MetricsPanel    from './components/MetricsPanel';
import { PRESETS, PRESET_HIGHWAY_CONCRETE, type PresetKey } from './data/presets';
import { computeAcoustics, type AcousticMetrics } from './engine/acoustics';
import type { RoomState } from './types/room';

export default function App() {
  const [room, setRoom] = useState<RoomState>(PRESET_HIGHWAY_CONCRETE);
  const [activePreset, setActivePreset] = useState<PresetKey | null>('highway');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [isABBaselineActive, setIsABBaselineActive] = useState(false);

  // Highway-side concrete baseline metrics for before/after comparison deltas
  const baselineMetrics: AcousticMetrics = useMemo(() => {
    return computeAcoustics(PRESET_HIGHWAY_CONCRETE);
  }, []);

  // When user drags entities or clicks walls directly, clear preset selection
  const handleRoomChange = useCallback((next: RoomState) => {
    setRoom(next);
    setActivePreset(null);
  }, []);

  // Load preset scenario
  const handlePresetSelect = useCallback((key: PresetKey) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (preset) {
      setRoom(preset.state);
      setActivePreset(key);
    }
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-950 font-sans select-none text-slate-200 md:flex-row">
      {/* ── Left: 65% Interactive 3D Classroom Viewport ── */}
      <div className="relative h-[52vh] min-h-0 w-full shrink-0 p-2 pb-1 flex flex-col md:h-full md:flex-[65] md:p-3 md:pr-1.5">
        <div className="canvas-placeholder h-full rounded-2xl overflow-hidden border border-white/5 relative">
          {/* Header Brand Badge */}
          <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 pointer-events-none bg-surface-900/80 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
            <span className="text-base">🔊</span>
            <span className="text-sm font-black tracking-tight text-white text-glow-teal">
              DINIG
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 ml-1 border-l border-white/20 pl-2">
              Classroom Acoustics
            </span>
          </div>

          {/* Interactive 2.5D Canvas */}
          <ClassroomCanvas
            room={room}
            onRoomChange={handleRoomChange}
            showHeatmap={showHeatmap}
          />

          {/* Floating Canvas Action Toolbar */}
          <CanvasToolbar
            room={room}
            onRoomChange={handleRoomChange}
            showHeatmap={showHeatmap}
            onToggleHeatmap={() => setShowHeatmap((v) => !v)}
          />

          {/* Bottom Legend Strip */}
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-start gap-2 pointer-events-none md:flex-nowrap md:justify-between">
            <div className="flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-surface-900/85 backdrop-blur border border-white/10 px-3 py-1.5 shadow-lg md:gap-3.5 md:px-3.5">
              {[
                { color: '#475569', label: 'Concrete' },
                { color: '#0e7490', label: 'Acoustic Panel' },
                { color: '#38bdf8', label: 'Open Window' },
                { color: '#7c3aed', label: 'Curtain' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                  <span className="text-[10px] text-slate-300 font-medium">{label}</span>
                </div>
              ))}
              <div className="w-px h-3 bg-white/20" />
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-accent-400" />
                <span className="text-[10px] text-slate-300 font-medium">Teacher (T)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                <span className="text-[10px] text-slate-300 font-medium">Listener (L)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                <span className="text-[10px] text-slate-300 font-medium">Noise</span>
              </div>
            </div>

            {/* Room Dimension Pill */}
            <div className="hidden rounded-xl bg-surface-900/85 backdrop-blur border border-white/10 px-3 py-1.5 shadow-lg md:block">
              <span className="text-[10px] text-slate-400 font-mono">
                {room.dimensions.width}m × {room.dimensions.depth}m × {room.dimensions.height}m standard DepEd
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: 35% Metrics & Auralization Panel ── */}
      <div className="min-h-0 min-w-0 w-full flex-1 p-2 pt-1 flex flex-col md:h-full md:flex-[35] md:min-w-[320px] md:max-w-[420px] md:p-3 md:pl-1.5 md:pt-3">
        <div className="h-full rounded-2xl border border-white/5 bg-surface-900 shadow-2xl overflow-hidden flex flex-col">
          <MetricsPanel
            room={room}
            activePreset={activePreset}
            onPresetSelect={handlePresetSelect}
            onRoomChange={handleRoomChange}
            baselineMetrics={baselineMetrics}
            baselineLabel="Highway Concrete"
            isABBaselineActive={isABBaselineActive}
            onABToggle={(isBaseline) => setIsABBaselineActive(isBaseline)}
          />
        </div>
      </div>
    </div>
  );
}
