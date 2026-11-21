// ============================================================
// TinigAral — Room Type Definitions
// All positions are in metres; angles in radians (0 = East, CCW+)
// Default dimensions: standard Philippine concrete classroom
// ============================================================

// ── Wall / surface materials ──────────────────────────────────
export type WallMaterial =
  | 'concrete'          // bare concrete / CHB — α ≈ 0.02
  | 'acoustic_panel'    // fibreglass / foam panel  — α ≈ 0.65
  | 'open_window'       // fully open aperture     — α ≈ 0.95 (highly absorptive + TL loss)
  | 'curtained_window'; // heavy curtain over window — α ≈ 0.45

// ── Speech intelligibility status ────────────────────────────
export type IntelligibilityStatus = 'Optimal' | 'Strained' | 'Critical';

// ── Room geometry ─────────────────────────────────────────────
/**
 * Overall room dimensions in metres.
 * Defaults reflect the DepEd standard Philippine concrete classroom.
 */
export interface RoomDimensions {
  /** Width (east-west) in metres. Default: 9 m */
  width: number;
  /** Depth (north-south) in metres. Default: 7 m */
  depth: number;
  /** Ceiling height in metres. Default: 3 m */
  height: number;
}

export const DEFAULT_ROOM_DIMENSIONS: RoomDimensions = {
  width: 9,
  depth: 7,
  height: 3,
};

// ── Entities ──────────────────────────────────────────────────
/**
 * Teacher position and facing direction.
 * Seated at the front of the room by default.
 */
export interface Teacher {
  /** X position in metres from room origin (bottom-left) */
  x: number;
  /** Y position in metres from room origin (bottom-left) */
  y: number;
  /**
   * Facing angle in radians.
   * 0 = East, π/2 = North, π = West, 3π/2 = South (standard math convention).
   * Default: π/2 (teacher faces towards class, i.e. North).
   */
  angle: number;
}

/**
 * Active listener (student or evaluator whose acoustic metrics are computed).
 * Typically positioned at the back or centre of the class.
 */
export interface ActiveListener {
  /** X position in metres */
  x: number;
  /** Y position in metres */
  y: number;
}

/**
 * A cluster of student desks / chairs.
 * Contributes absorption when occupied (0.45 Sabins per occupied seat).
 */
export interface DeskCluster {
  id: string;
  /** X centre of cluster in metres */
  x: number;
  /** Y centre of cluster in metres */
  y: number;
  /** Number of chairs in this cluster */
  seats: number;
  /** True when students are present — affects absorption calculation */
  occupied: boolean;
}

/**
 * A single wall or partial surface segment.
 * Used to define the room boundary and interior partitions.
 */
export interface WallSegment {
  id: string;
  /** Start point X in metres */
  x1: number;
  /** Start point Y in metres */
  y1: number;
  /** End point X in metres */
  x2: number;
  /** End point Y in metres */
  y2: number;
  material: WallMaterial;
}

/**
 * An ambient noise source (e.g. traffic, fan, construction).
 * Radiates omni-directionally; attenuated by distance and wall transmission loss.
 */
export interface NoiseSource {
  id: string;
  /** X position in metres */
  x: number;
  /** Y position in metres */
  y: number;
  /** Human-readable label (e.g. "Tricycle Traffic") */
  label: string;
  /**
   * Source sound pressure level at 1 metre in dBA.
   * Example values:
   *   Tricycle Traffic  — 78 dBA
   *   Electric Fan      — 55 dBA
   *   HVAC Unit         — 62 dBA
   *   Construction Noise — 85 dBA
   */
  dbA: number;
}

// ── Full room state ───────────────────────────────────────────
/**
 * Complete snapshot of the simulated classroom.
 * This is the single source of truth consumed by both the
 * acoustic engine and the 2.5D canvas renderer.
 */
export interface RoomState {
  dimensions: RoomDimensions;
  teacher: Teacher;
  activeListener: ActiveListener;
  deskClusters: DeskCluster[];
  wallSegments: WallSegment[];
  noiseSources: NoiseSource[];
}
