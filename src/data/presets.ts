// ============================================================
// DINIG — Preset Scenario Definitions
// Three ready-to-load classroom configurations
// ============================================================

import type { RoomState } from '../types/room';

// ── Helper: build the 4 perimeter walls of a 9×7 room ───────
function buildPerimeterWalls(
  configs: Array<{ id: string; material: 'concrete' | 'acoustic_panel' | 'open_window' | 'curtained_window' }>
) {
  // Walls: South (bottom), East (right), North (top), West (left)
  const edges = [
    { x1: 0, y1: 0, x2: 9, y2: 0 },  // South wall
    { x1: 9, y1: 0, x2: 9, y2: 7 },  // East wall
    { x1: 9, y1: 7, x2: 0, y2: 7 },  // North wall
    { x1: 0, y1: 7, x2: 0, y2: 0 },  // West wall
  ];
  return edges.map((e, i) => ({ ...e, ...configs[i] }));
}

// ── Shared desk layout (5 rows × 8 students) ─────────────────
function buildDesks(occupied: boolean) {
  const desks = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      desks.push({
        id:       `desk-r${row}-c${col}`,
        x:        2 + col * 4.5,
        y:        1.5 + row * 1.1,
        seats:    4,
        occupied,
      });
    }
  }
  return desks;
}

// ── Preset 1: Highway-Side Bare Concrete ─────────────────────
export const PRESET_HIGHWAY_CONCRETE: RoomState = {
  dimensions: { width: 9, depth: 7, height: 3 },
  teacher: { x: 4.5, y: 0.6, angle: Math.PI / 2 },
  activeListener: { x: 4.5, y: 5.5 },
  deskClusters: buildDesks(true),
  wallSegments: buildPerimeterWalls([
    { id: 'wall-south', material: 'concrete' },
    { id: 'wall-east',  material: 'open_window' },  // road-side windows
    { id: 'wall-north', material: 'concrete' },
    { id: 'wall-west',  material: 'concrete' },
  ]),
  noiseSources: [
    { id: 'ns-tricycle', x: 10.5, y: 3.5, label: 'Tricycle Traffic', dbA: 78 },
    { id: 'ns-fan',      x: 8.5,  y: 6.5, label: 'Electric Fan',     dbA: 55 },
  ],
};

// ── Preset 2: Curtains + Back-Wall Acoustic Panels ──────────
export const PRESET_TREATED: RoomState = {
  dimensions: { width: 9, depth: 7, height: 3 },
  teacher: { x: 4.5, y: 0.6, angle: Math.PI / 2 },
  activeListener: { x: 4.5, y: 5.5 },
  deskClusters: buildDesks(true),
  wallSegments: buildPerimeterWalls([
    { id: 'wall-south', material: 'acoustic_panel' }, // front panel
    { id: 'wall-east',  material: 'curtained_window' },
    { id: 'wall-north', material: 'acoustic_panel' },  // back panel
    { id: 'wall-west',  material: 'curtained_window' },
  ]),
  noiseSources: [
    { id: 'ns-tricycle', x: 10.5, y: 3.5, label: 'Tricycle Traffic', dbA: 78 },
    { id: 'ns-fan',      x: 8.5,  y: 6.5, label: 'Electric Fan',     dbA: 55 },
  ],
};

// ── Preset 3: Teacher at Centre Room ─────────────────────────
export const PRESET_CENTRE_TEACHER: RoomState = {
  dimensions: { width: 9, depth: 7, height: 3 },
  teacher: { x: 4.5, y: 3.5, angle: Math.PI / 2 },
  activeListener: { x: 4.5, y: 5.8 },
  deskClusters: [
    // Ring of desks around teacher
    { id: 'desk-front-l', x: 2,   y: 2,   seats: 4, occupied: true },
    { id: 'desk-front-r', x: 7,   y: 2,   seats: 4, occupied: true },
    { id: 'desk-mid-l',   x: 1.5, y: 3.5, seats: 4, occupied: true },
    { id: 'desk-mid-r',   x: 7.5, y: 3.5, seats: 4, occupied: true },
    { id: 'desk-back-l',  x: 2,   y: 5,   seats: 4, occupied: true },
    { id: 'desk-back-r',  x: 7,   y: 5,   seats: 4, occupied: true },
    { id: 'desk-back-c',  x: 4.5, y: 5.8, seats: 4, occupied: true },
  ],
  wallSegments: buildPerimeterWalls([
    { id: 'wall-south', material: 'concrete' },
    { id: 'wall-east',  material: 'open_window' },
    { id: 'wall-north', material: 'concrete' },
    { id: 'wall-west',  material: 'concrete' },
  ]),
  noiseSources: [
    { id: 'ns-tricycle', x: 10.5, y: 3.5, label: 'Tricycle Traffic', dbA: 78 },
  ],
};

export const PRESETS = [
  { key: 'highway',  label: '1. Highway-Side Bare Concrete',   state: PRESET_HIGHWAY_CONCRETE },
  { key: 'treated',  label: '2. Curtains + Back-Wall Panels',  state: PRESET_TREATED          },
  { key: 'centre',   label: '3. Teacher Centre-Room',          state: PRESET_CENTRE_TEACHER   },
] as const;

export type PresetKey = typeof PRESETS[number]['key'];
