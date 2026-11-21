// ============================================================
// DINIG — CanvasToolbar.tsx
// Compact floating toolbar for adding/removing desks & noise sources
// ============================================================

import React, { useState } from 'react';
import {
  Plus, Minus, Volume2, Grid3x3, Trash2, Radio,
} from 'lucide-react';
import type { RoomState, NoiseSource, DeskCluster } from '../types/room';

interface CanvasToolbarProps {
  room:          RoomState;
  onRoomChange:  (room: RoomState) => void;
  showHeatmap:   boolean;
  onToggleHeatmap: () => void;
}

const NOISE_PRESETS: Array<{ label: string; dbA: number; offsetX: number; offsetY: number }> = [
  { label: 'Tricycle Traffic', dbA: 78,  offsetX:  1.5, offsetY:  0   },
  { label: 'Electric Fan',     dbA: 55,  offsetX:  0,   offsetY:  1.5 },
  { label: 'HVAC Unit',        dbA: 62,  offsetX: -1.5, offsetY:  0   },
  { label: 'Construction',     dbA: 85,  offsetX:  0,   offsetY: -1.5 },
];

let _noiseId = 100;
let _deskId  = 100;

const CanvasToolbar: React.FC<CanvasToolbarProps> = ({
  room, onRoomChange, showHeatmap, onToggleHeatmap,
}) => {
  const [noiseMenuOpen, setNoiseMenuOpen] = useState(false);

  // ── Add a row of desks (2 clusters) ─────────────────────
  const addDeskRow = () => {
    const rows      = room.deskClusters;
    const maxY      = rows.length > 0 ? Math.max(...rows.map(d => d.y)) : 0.5;
    const lastAllowedY = room.dimensions.depth - 0.6;
    if (maxY + 0.7 > lastAllowedY) return;
    const nextY     = Math.min(maxY + 1.2, lastAllowedY);
    const newDesks: DeskCluster[] = [
      { id: `desk-new-${_deskId++}`, x: 2.25, y: nextY, seats: 4, occupied: true },
      { id: `desk-new-${_deskId++}`, x: 6.75, y: nextY, seats: 4, occupied: true },
    ];
    onRoomChange({ ...room, deskClusters: [...room.deskClusters, ...newDesks] });
  };

  // ── Remove last desk row (2 clusters) ───────────────────
  const removeDeskRow = () => {
    if (room.deskClusters.length < 2) return;
    onRoomChange({
      ...room,
      deskClusters: room.deskClusters.slice(0, -2),
    });
  };

  // ── Add noise source ─────────────────────────────────────
  const addNoiseSource = (preset: typeof NOISE_PRESETS[number]) => {
    const { dimensions: d } = room;
    const ns: NoiseSource = {
      id:    `ns-${_noiseId++}`,
      x:     d.width / 2 + preset.offsetX + d.width * 0.6,
      y:     d.depth / 2 + preset.offsetY,
      label: preset.label,
      dbA:   preset.dbA,
    };
    onRoomChange({ ...room, noiseSources: [...room.noiseSources, ns] });
    setNoiseMenuOpen(false);
  };

  // ── Remove last noise source ─────────────────────────────
  const removeLastNoise = () => {
    if (room.noiseSources.length === 0) return;
    onRoomChange({
      ...room,
      noiseSources: room.noiseSources.slice(0, -1),
    });
  };

  // ── Toggle all desks occupied/empty ─────────────────────
  const toggleOccupancy = () => {
    const allOccupied = room.deskClusters.every(d => d.occupied);
    onRoomChange({
      ...room,
      deskClusters: room.deskClusters.map(d => ({ ...d, occupied: !allOccupied })),
    });
  };

  const allOccupied = room.deskClusters.every(d => d.occupied);
  const maxDeskY = room.deskClusters.length > 0
    ? Math.max(...room.deskClusters.map((desk) => desk.y))
    : 0.5;
  const canAddDeskRow = maxDeskY + 0.7 <= room.dimensions.depth - 0.6;

  return (
    <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 pointer-events-none">

      {/* Desk controls */}
      <div className="flex items-center gap-1 rounded-xl bg-surface-800/90 backdrop-blur border border-white/10 p-1.5 shadow-xl pointer-events-auto">
        <span className="hidden px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 sm:inline">Desks</span>
        <ToolBtn icon={<Plus size={13}/>} label="Add desk row"    onClick={addDeskRow} disabled={!canAddDeskRow} />
        <ToolBtn icon={<Minus size={13}/>} label="Remove desk row" onClick={removeDeskRow} disabled={room.deskClusters.length < 2} />
        <div className="w-px h-5 bg-white/10 mx-0.5" />
        <ToolBtn
          icon={<Grid3x3 size={13}/>}
          label={allOccupied ? 'Mark empty' : 'Mark occupied'}
          onClick={toggleOccupancy}
          active={allOccupied}
        />
      </div>

      {/* Noise source controls */}
      <div className="relative flex items-center gap-1 rounded-xl bg-surface-800/90 backdrop-blur border border-white/10 p-1.5 shadow-xl pointer-events-auto">
        <span className="hidden px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 sm:inline">Noise</span>
        <div className="relative">
          <ToolBtn
            icon={<Radio size={13}/>}
            label="Add noise source"
            onClick={() => setNoiseMenuOpen(v => !v)}
            active={noiseMenuOpen}
          />
          {noiseMenuOpen && (
            <div className="absolute top-9 left-0 z-30 w-44 rounded-xl border border-white/10 bg-surface-800 shadow-2xl overflow-hidden animate-slide-up">
              {NOISE_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => addNoiseSource(p)}
                  className="w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-surface-700 hover:text-white flex justify-between items-center transition-colors"
                >
                  <span>{p.label}</span>
                  <span className="text-amber-400 font-mono">{p.dbA} dB</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <ToolBtn
          icon={<Trash2 size={13}/>}
          label="Remove last noise source"
          onClick={removeLastNoise}
          disabled={room.noiseSources.length === 0}
        />
        <div className="w-px h-5 bg-white/10 mx-0.5" />
        <span className="hidden pl-1 text-[10px] text-slate-500 font-mono sm:inline">{room.noiseSources.length} src</span>
      </div>

      {/* Heatmap toggle */}
      <button
        onClick={onToggleHeatmap}
        aria-pressed={showHeatmap}
        className={[
          'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold pointer-events-auto',
          'border backdrop-blur shadow-xl transition-all duration-200',
          showHeatmap
            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-400'
            : 'border-white/10 bg-surface-800/90 text-slate-400 hover:text-white hover:border-white/20',
        ].join(' ')}
      >
        <Volume2 size={13} />
        {showHeatmap ? 'Heatmap ON' : 'Heatmap OFF'}
      </button>
    </div>
  );
};

// ── Reusable icon button ──────────────────────────────────────
interface ToolBtnProps {
  icon:      React.ReactNode;
  label:     string;
  onClick:   () => void;
  disabled?: boolean;
  active?:   boolean;
}

const ToolBtn: React.FC<ToolBtnProps> = ({ icon, label, onClick, disabled, active }) => (
  <button
    title={label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={[
      'flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-150',
      active
        ? 'bg-accent-500/20 text-accent-400'
        : 'text-slate-400 hover:bg-white/10 hover:text-white',
      disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
    ].join(' ')}
  >
    {icon}
  </button>
);

export default CanvasToolbar;
