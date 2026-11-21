// ============================================================
// TinigAral — Acoustic Physics Engine
// Real-time calculations per ISO 3382 / Sabine theory
// All inputs: SI units (metres, dBA). Outputs: AcousticMetrics.
// ============================================================

import type {
  RoomState,
  WallMaterial,
  IntelligibilityStatus,
  DeskCluster,
} from '../types/room';

// ── Absorption coefficients (mid-band 500 Hz–1 kHz average) ──
export const ALPHA: Record<WallMaterial, number> = {
  concrete:         0.02,
  acoustic_panel:   0.65,
  open_window:      0.95, // open aperture ≈ perfect absorber
  curtained_window: 0.45,
};

// Floor (bare concrete tile) and ceiling (bare concrete slab)
const ALPHA_FLOOR   = 0.02;
const ALPHA_CEILING = 0.02;

// ── Wall transmission loss (dB insertion loss) ──────────────
export const WALL_TL: Record<WallMaterial, number> = {
  concrete:         28, // CHB / cast concrete
  acoustic_panel:   20, // panel mounted on concrete—still mostly concrete
  open_window:       2, // nearly transparent
  curtained_window:  9, // heavy curtain
};

// ── Teacher speech source level ──────────────────────────────
const SPEECH_REF_DBA  = 65;  // dBA @ 1 m on-axis
const SPEECH_REF_DIST = 1.0; // metres

// Directional gain factor: teacher voices are directional.
// On-axis (0°) → +3 dB, side (90°) → 0 dB, back (180°) → −6 dB
function directionalGain(relAngle: number): number {
  const a = Math.abs(((relAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const phi = a > Math.PI ? 2 * Math.PI - a : a; // 0–π
  // Simple cardioid-like: 3*cos(φ/2)^2 − 3  dB range
  return 3 * Math.cos(phi / 2) ** 2 - 3;
}

// ── Helpers ──────────────────────────────────────────────────
function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) || 0.01;
}

/** Energy sum of several dBA levels → combined dBA */
function energySum(...levels: number[]): number {
  if (levels.length === 0) return -Infinity;
  const sum = levels.reduce((acc, L) => acc + 10 ** (L / 10), 0);
  return 10 * Math.log10(sum);
}

/** Length of a wall segment in metres */
function segmentLength(x1: number, y1: number, x2: number, y2: number): number {
  return dist(x1, y1, x2, y2);
}

function closestPointOnSegment(x: number, y: number, seg: RoomState['wallSegments'][number]): [number, number] {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - seg.x1) * dx + (y - seg.y1) * dy) / lengthSquared));
  return [seg.x1 + t * dx, seg.y1 + t * dy];
}

// ── Output shape ─────────────────────────────────────────────
export interface AcousticMetrics {
  /** Total absorption in Sabins (m²) */
  totalAbsorption: number;
  /** Sabine RT60 in seconds */
  rt60: number;
  /** Direct + reverberant speech level at ActiveListener (dBA) */
  speechLevel: number;
  /** Combined infiltrated noise level at ActiveListener (dBA) */
  noiseLevel: number;
  /** Signal-to-Noise Ratio (dB) */
  snr: number;
  /** Intelligibility score 0–100 % */
  intelligibilityScore: number;
  /** Qualitative status */
  intelligibilityStatus: IntelligibilityStatus;
}

// ── Per-desk intelligibility (for the seat heatmap) ─────────
export interface DeskMetrics extends AcousticMetrics {
  deskId: string;
}

// ── Main calculation ─────────────────────────────────────────
export function computeAcoustics(room: RoomState): AcousticMetrics {
  const { dimensions: d, teacher, activeListener, wallSegments, deskClusters, noiseSources } = room;
  const V = d.width * d.depth * d.height; // room volume m³

  // ── 1. Total Sound Absorption (Sabins) ───────────────────
  // Floor & ceiling
  const floorArea   = d.width * d.depth;
  const ceilingArea = d.width * d.depth;
  let A = floorArea * ALPHA_FLOOR + ceilingArea * ALPHA_CEILING;

  // Wall segments (the user-defined boundary + interior panels)
  for (const seg of wallSegments) {
    const len  = segmentLength(seg.x1, seg.y1, seg.x2, seg.y2);
    const area = len * d.height;
    A += area * ALPHA[seg.material];
  }

  // Any wall area NOT covered by segments defaults to concrete.
  // (We assume the room perimeter is fully described by wallSegments,
  //  so no extra "remainder" term is needed here.)

  // Occupied student chairs: 0.45 Sabins per occupied seat
  const occupiedSeats = deskClusters
    .filter((dc: DeskCluster) => dc.occupied)
    .reduce((acc: number, dc: DeskCluster) => acc + dc.seats, 0);
  A += occupiedSeats * 0.45;

  // Safety floor to avoid divide-by-zero in degenerate configs
  A = Math.max(A, 0.5);

  // ── 2. Sabine RT60 ───────────────────────────────────────
  // RT60 = 0.161 × V / A
  const rt60 = (0.161 * V) / A;

  // ── 3. Direct + Reverberant Speech Level ─────────────────
  // Distance from teacher to active listener (clamped to min 0.5m near-field limit)
  const dTeacher = Math.max(0.5, dist(teacher.x, teacher.y, activeListener.x, activeListener.y));

  // Angle from teacher to listener, relative to teacher's facing angle
  const angleToListener = Math.atan2(
    activeListener.y - teacher.y,
    activeListener.x - teacher.x,
  );
  const relAngle = teacher.angle - angleToListener;
  const dGain    = directionalGain(relAngle);

  // Inverse-square direct field: L_direct = Lref + 20·log10(dref/d) + directional
  const lDirect =
    SPEECH_REF_DBA +
    20 * Math.log10(SPEECH_REF_DIST / dTeacher) +
    dGain;

  // Reverberant field level (diffuse field): L_rev = Lw − 10·log10(A)
  // Approximate Lw from Lp @ 1 m: Lw ≈ Lp(1m) + 11 dB (anechoic)
  const lw   = SPEECH_REF_DBA + 11;
  const lRev = lw - 10 * Math.log10(A);

  // Combined (energy sum of direct and reverberant)
  const speechLevel = energySum(lDirect, lRev);

  // ── 4. Infiltrated / Indoor Noise Level ───────────────────
  // Differentiates between indoor noise sources (e.g. electric fan inside room)
  // and outdoor sources (e.g. tricycle traffic outside penetrating walls).
  const noiseLevelsAtListener: number[] = noiseSources.map((ns) => {
    const isInside =
      ns.x >= 0 && ns.x <= d.width && ns.y >= 0 && ns.y <= d.depth;

    if (isInside) {
      // Indoor noise source: no wall transmission loss!
      const dDirect = Math.max(0.5, dist(ns.x, ns.y, activeListener.x, activeListener.y));
      const lDir = ns.dbA + 20 * Math.log10(1 / dDirect);
      const lwIndoor = ns.dbA + 11;
      const lRevIndoor = lwIndoor - 10 * Math.log10(A);
      return energySum(lDir, lRevIndoor);
    }

    // Outdoor noise source: penetrates through closest boundary wall
    const roomCx = d.width / 2;
    const roomCy = d.depth / 2;

    let bestTL = WALL_TL.concrete; // default: solid concrete wall
    let minSegDist = Infinity;
    let wallPoint: [number, number] = [roomCx, roomCy];

    for (const seg of wallSegments) {
      const point = closestPointOnSegment(ns.x, ns.y, seg);
      const segD = dist(ns.x, ns.y, point[0], point[1]);
      if (segD < minSegDist) {
        minSegDist = segD;
        bestTL = WALL_TL[seg.material];
        wallPoint = point;
      }
    }

    if (!Number.isFinite(minSegDist)) {
      minSegDist = dist(ns.x, ns.y, roomCx, roomCy);
    }

    // Level at wall exterior face (inverse-square from source)
    const lAtWall = ns.dbA + 20 * Math.log10(1 / Math.max(minSegDist, 1));

    // After transmission loss through wall
    const lAfterWall = lAtWall - bestTL;

    // Further decay from wall to listener
    const dInside = Math.max(dist(wallPoint[0], wallPoint[1], activeListener.x, activeListener.y), 0.5);
    return lAfterWall + 20 * Math.log10(1 / Math.max(dInside, 1));
  });

  const noiseLevel =
    noiseLevelsAtListener.length > 0
      ? energySum(...noiseLevelsAtListener)
      : 25; // ambient floor when no sources defined

  // ── 5. SNR & Intelligibility ─────────────────────────────
  const snr = speechLevel - noiseLevel;

  // RT60 smearing penalty: each 0.3 s over 0.5 s costs ~8 intelligibility points
  const rt60Penalty = Math.max(0, (rt60 - 0.5) / 0.3) * 8;

  // Base score from SNR: 100% at SNR ≥ +15 dB, 0% at SNR ≤ −10 dB
  const snrScore = Math.max(0, Math.min(100, ((snr + 10) / 25) * 100));

  const intelligibilityScore = Math.max(0, Math.min(100, snrScore - rt60Penalty));

  let intelligibilityStatus: IntelligibilityStatus;
  if (intelligibilityScore >= 70) {
    intelligibilityStatus = 'Optimal';
  } else if (intelligibilityScore >= 40) {
    intelligibilityStatus = 'Strained';
  } else {
    intelligibilityStatus = 'Critical';
  }

  return {
    totalAbsorption: A,
    rt60,
    speechLevel,
    noiseLevel,
    snr,
    intelligibilityScore,
    intelligibilityStatus,
  };
}

// ── Per-desk heatmap metrics ──────────────────────────────────
/**
 * Compute intelligibility metrics for every desk cluster individually.
 * Used by the seat heatmap toggle.
 */
export function computeDeskHeatmap(room: RoomState): DeskMetrics[] {
  return room.deskClusters.map((desk) => {
    const fakeRoom: RoomState = {
      ...room,
      activeListener: { x: desk.x, y: desk.y },
    };
    const metrics = computeAcoustics(fakeRoom);
    return { ...metrics, deskId: desk.id };
  });
}

// ── Preset scenario helpers ───────────────────────────────────
export const INTELLIGIBILITY_COLOR = {
  Optimal:  '#34d399', // emerald
  Strained: '#fbbf24', // amber
  Critical: '#fb7185', // rose
} as const satisfies Record<IntelligibilityStatus, string>;
