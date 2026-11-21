// ============================================================
// DINIG — ClassroomCanvas.tsx
// Interactive 3D Orbit Camera & Classroom Viewport
// Fixed: Chair visibility with unified 3D depth-sorting & cutaway walls
// Added: Spatial Passing Vehicles, Continuous Rain VFX, Pointer Capture,
// Wall Hover Tooltips, and Teacher Rotation Handle
// ============================================================

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import {
  RotateCcw,
  Compass,
  Grid,
  User,
} from 'lucide-react';
import type { RoomState, WallMaterial, DeskCluster, NoiseSource, WallSegment } from '../types/room';
import {
  computeDeskHeatmap,
  INTELLIGIBILITY_COLOR,
  type DeskMetrics,
} from '../engine/acoustics';
import {
  audioEngine,
  type AudioEngineState,
  type ActiveVehicleState,
} from '../engine/audioEngine';

export type CameraPreset = 'isometric' | 'topdown' | 'teacher' | 'custom' | 'reset';

interface CameraState {
  yaw: number;       // Horizontal orbit angle in radians around vertical axis
  pitch: number;     // Vertical elevation angle in radians (π/14 to π/2)
  zoom: number;      // Scale multiplier (0.4 to 3.0)
  panX: number;      // Pan offset in screen pixels
  panY: number;      // Pan offset in screen pixels
}

const DEFAULT_CAMERA: CameraState = {
  yaw: Math.PI / 6,    // 30° axonometric
  pitch: 0.65,         // ~37° elevation angle
  zoom: 1.0,
  panX: 0,
  panY: 0,
};

const PIXELS_PER_METRE = 54;

const COLOURS = {
  floor:            '#131c2e',
  floorGridLine:    'rgba(56,189,248,0.13)',
  floorBorder:      'rgba(56,189,248,0.3)',
  concrete:         '#475569',
  concreteDark:     '#334155',
  acoustic_panel:   '#0e7490',
  acoustic_panelDk: '#0a5a70',
  open_window:      '#38bdf8',
  open_windowDk:    '#0284c7',
  curtained_window: '#7c3aed',
  curtained_windowDk:'#5b21b6',
  desk:             '#78350f',
  deskTop:          '#92400e',
  deskOccupied:     '#451a03',
  studentDot:       '#fde68a',
  teacher:          '#38bdf8',
  listener:         '#a78bfa',
  speechWave:       'rgba(56,189,248,',
  noiseWave:        'rgba(251,146,60,',
  noiseIcon:        '#fb923c',
} as const;

// ── 3D Projection Helpers ─────────────────────────────────────

function projectPoint(
  rx: number,
  ry: number,
  rz: number,
  ox: number,
  oy: number,
  cam: CameraState,
  roomW: number,
  roomD: number
): [number, number] {
  const cx = roomW / 2;
  const cy = roomD / 2;
  const dx = rx - cx;
  const dy = ry - cy;
  const dz = rz;

  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const x1 = dx * cosY - dy * sinY;
  const y1 = dx * sinY + dy * cosY;

  const sinP = Math.sin(cam.pitch);
  const cosP = Math.cos(cam.pitch);
  const ppm = PIXELS_PER_METRE * cam.zoom;

  const sx = ox + cam.panX + x1 * ppm;
  const sy = oy + cam.panY - (y1 * sinP + dz * cosP) * ppm;

  return [sx, sy];
}

function screenToGround(
  sx: number,
  sy: number,
  ox: number,
  oy: number,
  cam: CameraState,
  roomW: number,
  roomD: number
): [number, number] {
  const ppm = PIXELS_PER_METRE * cam.zoom;
  if (ppm <= 0) return [roomW / 2, roomD / 2];

  const x1 = (sx - ox - cam.panX) / ppm;
  const sinP = Math.max(0.15, Math.sin(cam.pitch));
  const y1 = -(sy - oy - cam.panY) / (ppm * sinP);

  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const dx = x1 * cosY + y1 * sinY;
  const dy = -x1 * sinY + y1 * cosY;

  const rx = roomW / 2 + dx;
  const ry = roomD / 2 + dy;

  if (!Number.isFinite(rx) || !Number.isFinite(ry)) {
    return [roomW / 2, roomD / 2];
  }

  return [rx, ry];
}

const MATERIAL_CYCLE: WallMaterial[] = [
  'concrete',
  'open_window',
  'curtained_window',
  'acoustic_panel',
];
function cycleMaterial(m: WallMaterial): WallMaterial {
  const idx = MATERIAL_CYCLE.indexOf(m);
  return MATERIAL_CYCLE[(idx + 1) % MATERIAL_CYCLE.length];
}

interface Ring {
  id: number;
  srcX: number;
  srcY: number;
  radius: number;
  maxR: number;
  alpha: number;
  kind: 'speech' | 'noise' | 'vehicle';
  speed: number;
}

interface RainDropParticle {
  x: number;
  y: number;
  speed: number;
  len: number;
}

export interface ClassroomCanvasProps {
  room: RoomState;
  onRoomChange: (room: RoomState) => void;
  showHeatmap: boolean;
}

export const ClassroomCanvas: React.FC<ClassroomCanvasProps> = ({
  room,
  onRoomChange,
  showHeatmap,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const ringsRef = useRef<Ring[]>([]);
  const ringIdRef = useRef(0);
  const frameRef = useRef(0);
  const rainDropsRef = useRef<RainDropParticle[]>([]);

  // Camera Orbit State
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA);
  const cameraRef = useRef<CameraState>(DEFAULT_CAMERA);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const [activePreset, setActivePreset] = useState<CameraPreset>('isometric');

  // Heatmap & Audio Engine State
  const [deskMetrics, setDeskMetrics] = useState<DeskMetrics[]>([]);
  const deskMetricsById = useMemo(
    () => new Map(deskMetrics.map((metric) => [metric.deskId, metric])),
    [deskMetrics]
  );
  const desksById = useMemo(
    () => new Map(room.deskClusters.map((desk) => [desk.id, desk])),
    [room.deskClusters]
  );
  const [audioState, setAudioState] = useState<AudioEngineState>(audioEngine.getState());
  const [hoveredWall, setHoveredWall] = useState<WallSegment | null>(null);
  const [hoverPos, setHoverPos] = useState<[number, number] | null>(null);

  // Subscribe to Audio Engine state (for rain layer & spatial passing vehicles)
  useEffect(() => {
    return audioEngine.subscribe((s) => {
      setAudioState(s);
    });
  }, []);

  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const pendingRoomRef = useRef<RoomState | null>(null);
  const roomUpdateRafRef = useRef<number | null>(null);
  const scheduleRoomChange = useCallback((nextRoom: RoomState) => {
    pendingRoomRef.current = nextRoom;
    if (roomUpdateRafRef.current !== null) return;
    roomUpdateRafRef.current = requestAnimationFrame(() => {
      roomUpdateRafRef.current = null;
      const pendingRoom = pendingRoomRef.current;
      pendingRoomRef.current = null;
      if (pendingRoom) onRoomChange(pendingRoom);
    });
  }, [onRoomChange]);

  useEffect(() => () => {
    if (roomUpdateRafRef.current !== null) cancelAnimationFrame(roomUpdateRafRef.current);
  }, []);

  // Throttled / Debounced Heatmap Calculator to avoid 600 physics runs/sec
  const heatmapDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showHeatmap) return;
    if (heatmapDebounceRef.current) clearTimeout(heatmapDebounceRef.current);
    heatmapDebounceRef.current = window.setTimeout(() => {
      setDeskMetrics(computeDeskHeatmap(roomRef.current));
    }, 60);
    return () => {
      if (heatmapDebounceRef.current !== null) {
        clearTimeout(heatmapDebounceRef.current);
        heatmapDebounceRef.current = null;
      }
    };
  }, [room, showHeatmap]);

  // Dragging & Interaction State
  type DragTarget = 'teacher' | 'teacher_rotate' | 'listener' | `noise:${string}`;
  const interactionRef = useRef<{
    isDraggingMarker: boolean;
    dragTarget: DragTarget | null;
    isOrbiting: boolean;
    isPanning: boolean;
    startX: number;
    startY: number;
  }>({
    isDraggingMarker: false,
    dragTarget: null,
    isOrbiting: false,
    isPanning: false,
    startX: 0,
    startY: 0,
  });

  const originRef = useRef<[number, number]>([0, 0]);
  const keyboardWallIndexRef = useRef(0);

  const computeOrigin = useCallback((w: number, h: number): [number, number] => {
    return [w / 2, h / 2 + 30];
  }, []);

  // Initialize rain particles
  useEffect(() => {
    const drops: RainDropParticle[] = [];
    for (let i = 0; i < 90; i++) {
      drops.push({
        x: Math.random() * 1200,
        y: Math.random() * 800,
        speed: 8 + Math.random() * 8,
        len: 12 + Math.random() * 10,
      });
    }
    rainDropsRef.current = drops;
  }, []);

  // ── Camera Preset Handlers ──────────────────────────────────
  const applyPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    const r = roomRef.current;
    if (preset === 'isometric') {
      setCamera({
        yaw: Math.PI / 6,
        pitch: 0.65,
        zoom: 1.0,
        panX: 0,
        panY: 0,
      });
    } else if (preset === 'topdown') {
      setCamera({
        yaw: 0,
        pitch: Math.PI / 2,
        zoom: 1.05,
        panX: 0,
        panY: 0,
      });
    } else if (preset === 'teacher') {
      const facingAngle = r.teacher.angle;
      setCamera({
        yaw: facingAngle - Math.PI / 2,
        pitch: 0.35,
        zoom: 1.35,
        panX: 0,
        panY: 40,
      });
    } else if (preset === 'reset') {
      setCamera(DEFAULT_CAMERA);
      setActivePreset('isometric');
    }
  };

  // ── Main Draw Method ────────────────────────────────────────
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
      const r = roomRef.current;
      const { dimensions: d } = r;
      const [ox, oy] = originRef.current;
      const cam = cameraRef.current;

      ctx.clearRect(0, 0, w, h);

      const prj = (rx: number, ry: number, rz: number = 0) =>
        projectPoint(rx, ry, rz, ox, oy, cam, d.width, d.depth);

      // Camera orientation components
      const cosY = Math.cos(cam.yaw);
      const sinY = Math.sin(cam.yaw);
      const cx = d.width / 2;
      const cy = d.depth / 2;

      // ── 1. Floor & Road Surface ───────────────────────────
      // East road outside window (x from 9 to 13.5)
      const road_bl = prj(9.2, -6, 0);
      const road_br = prj(14.0, -6, 0);
      const road_tr = prj(14.0, d.depth + 7, 0);
      const road_tl = prj(9.2, d.depth + 7, 0);

      ctx.beginPath();
      ctx.moveTo(...road_bl);
      ctx.lineTo(...road_br);
      ctx.lineTo(...road_tr);
      ctx.lineTo(...road_tl);
      ctx.closePath();
      ctx.fillStyle = '#0b0f19';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Road dashed center line
      ctx.beginPath();
      ctx.moveTo(...prj(11.5, -6, 0));
      ctx.lineTo(...prj(11.5, d.depth + 7, 0));
      ctx.strokeStyle = 'rgba(251,191,36,0.3)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Classroom Floor
      const fl_bl = prj(0, 0, 0);
      const fl_br = prj(d.width, 0, 0);
      const fl_tr = prj(d.width, d.depth, 0);
      const fl_tl = prj(0, d.depth, 0);

      ctx.beginPath();
      ctx.moveTo(...fl_bl);
      ctx.lineTo(...fl_br);
      ctx.lineTo(...fl_tr);
      ctx.lineTo(...fl_tl);
      ctx.closePath();
      ctx.fillStyle = COLOURS.floor;
      ctx.fill();
      ctx.strokeStyle = COLOURS.floorBorder;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 1-metre Grid Lines on Floor
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...fl_bl);
      ctx.lineTo(...fl_br);
      ctx.lineTo(...fl_tr);
      ctx.lineTo(...fl_tl);
      ctx.closePath();
      ctx.clip();

      ctx.strokeStyle = COLOURS.floorGridLine;
      ctx.lineWidth = 0.75;
      for (let gx = 0; gx <= d.width; gx++) {
        ctx.beginPath();
        ctx.moveTo(...prj(gx, 0, 0));
        ctx.lineTo(...prj(gx, d.depth, 0));
        ctx.stroke();
      }
      for (let gy = 0; gy <= d.depth; gy++) {
        ctx.beginPath();
        ctx.moveTo(...prj(0, gy, 0));
        ctx.lineTo(...prj(d.width, gy, 0));
        ctx.stroke();
      }
      ctx.restore();

      // ── 2. Heatmap Overlays (Drawn on floor) ───────────────
      if (showHeatmap && deskMetrics.length > 0) {
        for (const dm of deskMetrics) {
          const desk = desksById.get(dm.deskId);
          if (!desk) continue;
          const col = INTELLIGIBILITY_COLOR[dm.intelligibilityStatus];

          ctx.beginPath();
          const steps = 24;
          const radiusM = 0.65;
          for (let s = 0; s <= steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const px = desk.x + radiusM * Math.cos(a);
            const py = desk.y + radiusM * Math.sin(a);
            const [sx, sy] = prj(px, py, 0);
            if (s === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.fillStyle = col + '50';
          ctx.fill();
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── 3. Wavefront Sound Rings ──────────────────────────
      for (const ring of ringsRef.current) {
        ctx.beginPath();
        const steps = 32;
        for (let s = 0; s <= steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          const px = ring.srcX + ring.radius * Math.cos(a);
          const py = ring.srcY + ring.radius * Math.sin(a);
          const [sx, sy] = prj(px, py, 0);
          if (s === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        const color =
          ring.kind === 'speech'
            ? COLOURS.speechWave
            : ring.kind === 'vehicle'
            ? 'rgba(251,191,36,'
            : COLOURS.noiseWave;
        ctx.strokeStyle = `${color}${ring.alpha.toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── 4. Unified 3D Depth-Sorted Render Queue ────────────
      // FIX FOR DISAPPEARING CHAIRS:
      // In true 3D rendering, all scene objects (desks, walls, teacher, listener,
      // vehicles, noise markers) are sorted by their camera depth distance
      // (farthest first, nearest last). Near walls facing the camera are rendered
      // cutaway (lowered sill height) so they NEVER physically occlude the chairs.
      type RenderableItem =
        | { type: 'wall'; seg: WallSegment; depth: number; isNearWall: boolean }
        | { type: 'desk'; desk: DeskCluster; depth: number }
        | { type: 'teacher'; depth: number }
        | { type: 'listener'; depth: number }
        | { type: 'noise'; ns: NoiseSource; depth: number }
        | { type: 'vehicle'; veh: ActiveVehicleState; depth: number };

      const queue: RenderableItem[] = [];
      const isTopDown = cam.pitch > 1.45;

      // Add walls
      for (const seg of r.wallSegments) {
        const mx = (seg.x1 + seg.x2) / 2;
        const my = (seg.y1 + seg.y2) / 2;
        const depth = (mx - cx) * sinY + (my - cy) * cosY;
        // In architectural cutaway: walls facing the camera (depth < 0) are cut down to baseboard height
        const isNearWall = depth < -0.2;
        queue.push({ type: 'wall', seg, depth, isNearWall });
      }

      // Add desks
      for (const desk of r.deskClusters) {
        const depth = (desk.x - cx) * sinY + (desk.y - cy) * cosY;
        queue.push({ type: 'desk', desk, depth });
      }

      // Add teacher
      const teacherDepth = (r.teacher.x - cx) * sinY + (r.teacher.y - cy) * cosY;
      queue.push({ type: 'teacher', depth: teacherDepth });

      // Add listener
      const listenerDepth = (r.activeListener.x - cx) * sinY + (r.activeListener.y - cy) * cosY;
      queue.push({ type: 'listener', depth: listenerDepth });

      // Add noise sources
      for (const ns of r.noiseSources) {
        const depth = (ns.x - cx) * sinY + (ns.y - cy) * cosY;
        queue.push({ type: 'noise', ns, depth });
      }

      // Add dynamic passing vehicles
      for (const veh of audioState.activeVehicles) {
        const depth = (veh.x - cx) * sinY + (veh.y - cy) * cosY;
        queue.push({ type: 'vehicle', veh, depth });
      }

      const isOverlayMarker = (item: RenderableItem) =>
        item.type === 'teacher' || item.type === 'listener' || item.type === 'noise' || item.type === 'vehicle';
      queue.sort((a, b) => {
        const overlayOrder = Number(isOverlayMarker(a)) - Number(isOverlayMarker(b));
        return overlayOrder || b.depth - a.depth;
      });

      // Render all objects in exact z-buffer order
      for (const item of queue) {
        if (item.type === 'wall') {
          drawWall3D(ctx, item.seg, prj, d.height, isTopDown, item.isNearWall);
        } else if (item.type === 'desk') {
          drawDesk3D(ctx, item.desk, prj, showHeatmap, deskMetricsById);
        } else if (item.type === 'teacher') {
          drawTeacher3D(ctx, r.teacher.x, r.teacher.y, r.teacher.angle, prj, t);
        } else if (item.type === 'listener') {
          drawListener3D(ctx, r.activeListener.x, r.activeListener.y, prj, t);
        } else if (item.type === 'noise') {
          drawNoiseSource3D(ctx, item.ns, prj, t);
        } else if (item.type === 'vehicle') {
          drawMovingVehicle3D(ctx, item.veh, prj, t);
        }
      }

      // ── 5. Ceiling Wireframe ──────────────────────────────
      if (!isTopDown) {
        drawCeilingOutline3D(ctx, d, prj);
      }

      // ── 6. Continuous Rain VFX ────────────────────────────
      if (audioState.isRainActive) {
        drawRainVFX(ctx, w, h);
      }
    },
    [showHeatmap, deskMetrics, deskMetricsById, desksById, audioState]
  );

  // ── Render Helpers ──────────────────────────────────────────

  function drawWall3D(
    ctx: CanvasRenderingContext2D,
    seg: WallSegment,
    prj: (x: number, y: number, z?: number) => [number, number],
    roomHeight: number,
    isTopDown: boolean,
    isNearWall: boolean
  ) {
    const isHovered = hoveredWall?.id === seg.id;
    const faceColor = COLOURS[seg.material] as string;
    const bL = prj(seg.x1, seg.y1, 0);
    const bR = prj(seg.x2, seg.y2, 0);

    if (isTopDown) {
      // Top-Down architectural boundary line
      ctx.beginPath();
      ctx.moveTo(...bL);
      ctx.lineTo(...bR);
      ctx.strokeStyle = isHovered ? '#38bdf8' : faceColor;
      ctx.lineWidth = isHovered ? 8 : 6;
      ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }

    // Cutaway: near walls facing camera are rendered low (0.45m sill height)
    // so camera line-of-sight to student desks is 100% unobstructed.
    const wallHeightM = isNearWall ? 0.45 : Math.min(roomHeight, 2.8);
    const tL = prj(seg.x1, seg.y1, wallHeightM);
    const tR = prj(seg.x2, seg.y2, wallHeightM);

    // Wall face
    ctx.beginPath();
    ctx.moveTo(...bL);
    ctx.lineTo(...bR);
    ctx.lineTo(...tR);
    ctx.lineTo(...tL);
    ctx.closePath();
    ctx.fillStyle = isNearWall ? `${faceColor}90` : faceColor;
    ctx.fill();
    ctx.strokeStyle = isHovered ? '#38bdf8' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = isHovered ? 2.5 : 1;
    ctx.stroke();

    // Material Cues
    if (!isNearWall) {
      if (seg.material === 'open_window') {
        for (let i = 1; i <= 4; i++) {
          const frac = i / 5;
          const slL = [bL[0] + (tL[0] - bL[0]) * frac, bL[1] + (tL[1] - bL[1]) * frac];
          const slR = [bR[0] + (tR[0] - bR[0]) * frac, bR[1] + (tR[1] - bR[1]) * frac];
          ctx.beginPath();
          ctx.moveTo(slL[0], slL[1]);
          ctx.lineTo(slR[0], slR[1]);
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else if (seg.material === 'curtained_window') {
        for (let f = 1; f <= 5; f++) {
          const frac = f / 6;
          const cTop = [tL[0] + (tR[0] - tL[0]) * frac, tL[1] + (tR[1] - tL[1]) * frac];
          const cBot = [bL[0] + (bR[0] - bL[0]) * frac, bL[1] + (bR[1] - bL[1]) * frac];
          ctx.beginPath();
          ctx.moveTo(cTop[0], cTop[1]);
          ctx.lineTo(cBot[0], cBot[1]);
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else if (seg.material === 'acoustic_panel') {
        ctx.beginPath();
        ctx.moveTo(...tL);
        ctx.lineTo(...tR);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
  }

  function drawDesk3D(
    ctx: CanvasRenderingContext2D,
    desk: DeskCluster,
    prj: (x: number, y: number, z?: number) => [number, number],
    showHeatmap: boolean,
    metricsById: ReadonlyMap<string, DeskMetrics>
  ) {
    const W = 0.55;
    const D = 0.35;
    const H = 0.72;

    const b0 = prj(desk.x - W, desk.y - D, 0);
    const b1 = prj(desk.x + W, desk.y - D, 0);
    const t0 = prj(desk.x - W, desk.y - D, H);
    const t1 = prj(desk.x + W, desk.y - D, H);
    const t2 = prj(desk.x + W, desk.y + D, H);
    const t3 = prj(desk.x - W, desk.y + D, H);

    // Front/Side face
    ctx.beginPath();
    ctx.moveTo(...b0);
    ctx.lineTo(...b1);
    ctx.lineTo(...t1);
    ctx.lineTo(...t0);
    ctx.closePath();
    ctx.fillStyle = desk.occupied ? COLOURS.deskOccupied : COLOURS.desk;
    ctx.fill();

    // Tabletop
    ctx.beginPath();
    ctx.moveTo(...t0);
    ctx.lineTo(...t1);
    ctx.lineTo(...t2);
    ctx.lineTo(...t3);
    ctx.closePath();
    ctx.fillStyle = COLOURS.deskTop;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // Student seating markers
    if (desk.occupied) {
      const seats = [
        [desk.x - W * 0.45, desk.y],
        [desk.x + W * 0.45, desk.y],
      ];
      for (const [sx, sy] of seats) {
        const [px, py] = prj(sx, sy, H + 0.35);
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = COLOURS.studentDot;
        ctx.fill();
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Heatmap Score centered above desk
    const dm = showHeatmap ? metricsById.get(desk.id) : undefined;
    if (dm) {
      const [dx, dy] = prj(desk.x, desk.y, H + 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(dm.intelligibilityScore)}%`, dx, dy);
    }
  }

  function drawTeacher3D(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    angle: number,
    prj: (x: number, y: number, z?: number) => [number, number],
    t: number
  ) {
    const [baseX, baseY] = prj(rx, ry, 0);
    const [headX, headY] = prj(rx, ry, 1.55);

    // Directional Speech Cone radiating from teacher mouth
    const coneAngle = Math.PI / 3.5;
    const coneLen = 2.4;
    const leftAngle = angle - coneAngle;
    const rightAngle = angle + coneAngle;

    const [leftX, leftY] = prj(rx + Math.cos(leftAngle) * coneLen, ry + Math.sin(leftAngle) * coneLen, 1.2);
    const [rightX, rightY] = prj(rx + Math.cos(rightAngle) * coneLen, ry + Math.sin(rightAngle) * coneLen, 1.2);
    const [tipX, tipY] = prj(rx + Math.cos(angle) * coneLen, ry + Math.sin(angle) * coneLen, 1.2);

    ctx.beginPath();
    ctx.moveTo(headX, headY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Rotation Handle Grip at cone tip
    ctx.beginPath();
    ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Floor base ring
    ctx.beginPath();
    ctx.arc(baseX, baseY, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56,189,248,0.3)';
    ctx.fill();

    // Teacher body stem
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(headX, headY);
    ctx.strokeStyle = COLOURS.teacher;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Teacher Head
    const pulse = Math.sin(t * 0.005) * 1.5;
    ctx.beginPath();
    ctx.arc(headX, headY, 7 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = COLOURS.teacher;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#06090f';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', headX, headY);
  }

  function drawListener3D(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    prj: (x: number, y: number, z?: number) => [number, number],
    t: number
  ) {
    const [baseX, baseY] = prj(rx, ry, 0);
    const [headX, headY] = prj(rx, ry, 1.4);

    const ringPhase = (t * 0.003) % 1;
    ctx.beginPath();
    ctx.arc(baseX, baseY, 8 + ringPhase * 12, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(167,139,250,${(1 - ringPhase) * 0.8})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(headX, headY);
    ctx.strokeStyle = COLOURS.listener;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(headX, headY, 7, 0, Math.PI * 2);
    ctx.fillStyle = COLOURS.listener;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#06090f';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('L', headX, headY);
  }

  function drawNoiseSource3D(
    ctx: CanvasRenderingContext2D,
    ns: NoiseSource,
    prj: (x: number, y: number, z?: number) => [number, number],
    t: number
  ) {
    const [baseX, baseY] = prj(ns.x, ns.y, 0);
    const [iconX, iconY] = prj(ns.x, ns.y, 1.1);

    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(iconX, iconY);
    ctx.strokeStyle = 'rgba(251,146,60,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const pulse = Math.sin(t * 0.006 + ns.x) * 2;
    ctx.beginPath();
    ctx.arc(iconX, iconY, 13 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#7c2d12';
    ctx.fill();
    ctx.strokeStyle = COLOURS.noiseIcon;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ns.dbA}`, iconX, iconY);

    ctx.fillStyle = '#fed7aa';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText(ns.label, iconX, iconY + 20);
  }

  // ── Dynamic Spatial Moving Vehicle Rendering ────────────────
  function drawMovingVehicle3D(
    ctx: CanvasRenderingContext2D,
    veh: ActiveVehicleState,
    prj: (x: number, y: number, z?: number) => [number, number],
    t: number
  ) {
    const [vx, vy] = prj(veh.x, veh.y, 0.4);

    // Vehicle Pulsing Halo
    const pulse = Math.sin(t * 0.01) * 3;
    ctx.beginPath();
    ctx.arc(vx, vy, 16 + pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251,191,36,0.18)';
    ctx.fill();

    // Vehicle Icon Body
    ctx.beginPath();
    ctx.arc(vx, vy, 12, 0, Math.PI * 2);
    ctx.fillStyle = veh.type === 'motorcycle' ? '#b45309' : '#d97706';
    ctx.fill();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Icon emoji
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(veh.type === 'motorcycle' ? '🏍️' : veh.type === 'tricycle' ? '🛺' : '🚗', vx, vy);

    // Label & Sound Level
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillText(`${veh.label} (${veh.dbA} dB)`, vx, vy - 18);
  }

  function drawCeilingOutline3D(
    ctx: CanvasRenderingContext2D,
    d: RoomState['dimensions'],
    prj: (x: number, y: number, z?: number) => [number, number]
  ) {
    const H = d.height;
    const corners: [number, number][] = [
      [0, 0],
      [d.width, 0],
      [d.width, d.depth],
      [0, d.depth],
    ];

    for (const [rx, ry] of corners) {
      const b = prj(rx, ry, 0);
      const t = prj(rx, ry, H);
      ctx.beginPath();
      ctx.moveTo(...b);
      ctx.lineTo(...t);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.beginPath();
    corners.forEach(([rx, ry], i) => {
      const p = prj(rx, ry, H);
      if (i === 0) ctx.moveTo(...p);
      else ctx.lineTo(...p);
    });
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Continuous Rain Layer VFX ────────────────────────────────
  function drawRainVFX(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.strokeStyle = 'rgba(186,230,253,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const drop of rainDropsRef.current) {
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - 3, drop.y + drop.len);
      drop.y += drop.speed;
      drop.x -= 1.2;
      if (drop.y > h) {
        drop.y = -20;
        drop.x = Math.random() * w;
      }
    }
    ctx.stroke();
  }

  // ── Wavefront Ring Physics Tick ──────────────────────────────
  const tickRings = useCallback((dt: number) => {
    const r = roomRef.current;

    // Speech ring from teacher
    if (frameRef.current % 85 === 0) {
      ringsRef.current.push({
        id: ringIdRef.current++,
        srcX: r.teacher.x,
        srcY: r.teacher.y,
        radius: 0.1,
        maxR: Math.max(r.dimensions.width, r.dimensions.depth) * 1.5,
        alpha: 0.8,
        kind: 'speech',
        speed: 2.4,
      });
    }

    // Steady noise ring
    if (frameRef.current % 110 === 0) {
      for (const ns of r.noiseSources) {
        ringsRef.current.push({
          id: ringIdRef.current++,
          srcX: ns.x,
          srcY: ns.y,
          radius: 0.1,
          maxR: Math.max(r.dimensions.width, r.dimensions.depth) * 1.5,
          alpha: 0.65,
          kind: 'noise',
          speed: 2.8,
        });
      }
    }

    // Moving vehicle Doppler soundwave rings
    if (frameRef.current % 40 === 0 && audioState.activeVehicles.length > 0) {
      for (const veh of audioState.activeVehicles) {
        ringsRef.current.push({
          id: ringIdRef.current++,
          srcX: veh.x,
          srcY: veh.y,
          radius: 0.2,
          maxR: 9.0,
          alpha: 0.75,
          kind: 'vehicle',
          speed: 3.2,
        });
      }
    }

    const dtS = dt / 1000;
    for (let i = ringsRef.current.length - 1; i >= 0; i--) {
      const ring = ringsRef.current[i];
      ring.radius += ring.speed * dtS;
      ring.alpha *= 1 - dtS * 0.45;
      if (ring.alpha <= 0.02 || ring.radius >= ring.maxR) {
        ringsRef.current.splice(i, 1);
      }
    }
  }, [audioState.activeVehicles]);

  // ── Animation Frame Loop ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastT = 0;

    const loop = (t: number) => {
      if (document.hidden) {
        rafRef.current = 0;
        return;
      }
      if (lastT !== 0 && t - lastT < 1000 / 30) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = t - lastT;
      lastT = t;
      frameRef.current++;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || canvas.width / dpr;
      const h = canvas.clientHeight || canvas.height / dpr;
      originRef.current = computeOrigin(w, h);

      tickRings(dt);
      draw(ctx, w, h, t);

      rafRef.current = requestAnimationFrame(loop);
    };

    const resume = () => {
      if (!document.hidden && rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      document.removeEventListener('visibilitychange', resume);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [computeOrigin, draw, tickRings]);

  // ── High-DPI Resize Observer ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    });

    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);

  // ── Hit Testing ─────────────────────────────────────────────
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const hitTest = (mx: number, my: number) => {
    const r = roomRef.current;
    const [ox, oy] = originRef.current;
    const cam = cameraRef.current;
    const prj = (x: number, y: number, z?: number) =>
      projectPoint(x, y, z || 0, ox, oy, cam, r.dimensions.width, r.dimensions.depth);

    // 1. Check Teacher Speech Cone Rotation Handle Tip
    const coneAngle = r.teacher.angle;
    const [tipX, tipY] = prj(
      r.teacher.x + Math.cos(coneAngle) * 2.4,
      r.teacher.y + Math.sin(coneAngle) * 2.4,
      1.2
    );
    if (Math.hypot(mx - tipX, my - tipY) < 14) {
      return { type: 'teacher_rotate' as const };
    }

    // 2. Check Teacher
    const [tx, ty] = prj(r.teacher.x, r.teacher.y, 1.55);
    if (Math.hypot(mx - tx, my - ty) < 22) {
      return { type: 'teacher' as const };
    }

    // 3. Check Active Listener
    const [lx, ly] = prj(r.activeListener.x, r.activeListener.y, 1.4);
    if (Math.hypot(mx - lx, my - ly) < 20) {
      return { type: 'listener' as const };
    }

    // 4. Check Noise Sources
    for (const ns of r.noiseSources) {
      const [nx, ny] = prj(ns.x, ns.y, 1.1);
      if (Math.hypot(mx - nx, my - ny) < 20) {
        return { type: `noise:${ns.id}` as DragTarget };
      }
    }

    // 5. Check Wall Segments
    for (const seg of r.wallSegments) {
      const midX = (seg.x1 + seg.x2) / 2;
      const midY = (seg.y1 + seg.y2) / 2;
      const [wx, wy] = prj(midX, midY, 1.0);
      if (Math.hypot(mx - wx, my - wy) < 26) {
        return { type: 'wall' as const, wall: seg };
      }
    }

    return null;
  };

  // ── Interactive Orbit & Drag with Pointer Capture ───────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Standard Pointer Capture prevents drag cancellation when leaving canvas bounds
    e.currentTarget.setPointerCapture(e.pointerId);

    const [mx, my] = getCanvasPoint(e);
    const hit = hitTest(mx, my);

    if (hit && hit.type === 'wall') {
      onRoomChange({
        ...roomRef.current,
        wallSegments: roomRef.current.wallSegments.map((seg) =>
          seg.id === hit.wall.id ? { ...seg, material: cycleMaterial(seg.material) } : seg
        ),
      });
      return;
    }

    if (hit) {
      interactionRef.current = {
        isDraggingMarker: true,
        dragTarget: hit.type as DragTarget,
        isOrbiting: false,
        isPanning: false,
        startX: mx,
        startY: my,
      };
      return;
    }

    // Background Click: Orbit or Pan
    if (e.button === 2 || e.button === 1 || e.shiftKey) {
      interactionRef.current = {
        isDraggingMarker: false,
        dragTarget: null,
        isOrbiting: false,
        isPanning: true,
        startX: mx,
        startY: my,
      };
    } else if (e.button === 0) {
      interactionRef.current = {
        isDraggingMarker: false,
        dragTarget: null,
        isOrbiting: true,
        isPanning: false,
        startX: mx,
        startY: my,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [mx, my] = getCanvasPoint(e);
    const state = interactionRef.current;

    // Hover detection for wall cues
    if (!state.isDraggingMarker && !state.isOrbiting && !state.isPanning) {
      const hit = hitTest(mx, my);
      if (hit && hit.type === 'wall') {
        setHoveredWall(hit.wall);
        setHoverPos([mx, my]);
      } else {
        setHoveredWall(null);
        setHoverPos(null);
      }
    }

    // 1. Dragging Object
    if (state.isDraggingMarker && state.dragTarget) {
      const [ox, oy] = originRef.current;
      const cam = cameraRef.current;
      const r = roomRef.current;

      const [rx, ry] = screenToGround(
        mx,
        my,
        ox,
        oy,
        cam,
        r.dimensions.width,
        r.dimensions.depth
      );

      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return;

      if (state.dragTarget === 'teacher_rotate') {
        // Direct manual teacher speech cone rotation
        const angle = Math.atan2(ry - r.teacher.y, rx - r.teacher.x);
        scheduleRoomChange({
          ...r,
          teacher: {
            ...r.teacher,
            angle: Number.isFinite(angle) ? angle : r.teacher.angle,
          },
        });
      } else if (state.dragTarget === 'teacher') {
        const clampedX = Math.max(0.4, Math.min(r.dimensions.width - 0.4, rx));
        const clampedY = Math.max(0.4, Math.min(r.dimensions.depth - 0.4, ry));
        scheduleRoomChange({
          ...r,
          teacher: {
            ...r.teacher,
            x: clampedX,
            y: clampedY,
          },
        });
      } else if (state.dragTarget === 'listener') {
        const clampedX = Math.max(0.4, Math.min(r.dimensions.width - 0.4, rx));
        const clampedY = Math.max(0.4, Math.min(r.dimensions.depth - 0.4, ry));
        scheduleRoomChange({
          ...r,
          activeListener: { x: clampedX, y: clampedY },
        });
      } else if (state.dragTarget.startsWith('noise:')) {
        const nsId = state.dragTarget.slice(6);
        const clampedX = Math.max(-2.5, Math.min(r.dimensions.width + 2.5, rx));
        const clampedY = Math.max(-2.5, Math.min(r.dimensions.depth + 2.5, ry));
        scheduleRoomChange({
          ...r,
          noiseSources: r.noiseSources.map((ns) =>
            ns.id === nsId ? { ...ns, x: clampedX, y: clampedY } : ns
          ),
        });
      }
      return;
    }

    // 2. Camera Orbiting
    if (state.isOrbiting) {
      setActivePreset('custom');
      const deltaX = mx - state.startX;
      const deltaY = my - state.startY;
      state.startX = mx;
      state.startY = my;

      setCamera((c) => ({
        ...c,
        yaw: (c.yaw + deltaX * 0.007) % (Math.PI * 2),
        pitch: Math.max(0.2, Math.min(Math.PI / 2, c.pitch - deltaY * 0.007)),
      }));
      return;
    }

    // 3. Camera Panning
    if (state.isPanning) {
      setActivePreset('custom');
      const deltaX = mx - state.startX;
      const deltaY = my - state.startY;
      state.startX = mx;
      state.startY = my;

      setCamera((c) => ({
        ...c,
        panX: c.panX + deltaX,
        panY: c.panY + deltaY,
      }));
      return;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
    interactionRef.current = {
      isDraggingMarker: false,
      dragTarget: null,
      isOrbiting: false,
      isPanning: false,
      startX: 0,
      startY: 0,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setActivePreset('custom');
      const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92;
      setCamera((current) => ({
        ...current,
        zoom: Math.max(0.45, Math.min(3.0, current.zoom * zoomFactor)),
      }));
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const r = roomRef.current;
    const step = 0.1;
    const directions: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const direction = directions[e.key];

    if (direction) {
      e.preventDefault();
      if (e.shiftKey) {
        onRoomChange({
          ...r,
          teacher: {
            ...r.teacher,
            x: Math.max(0.4, Math.min(r.dimensions.width - 0.4, r.teacher.x + direction[0])),
            y: Math.max(0.4, Math.min(r.dimensions.depth - 0.4, r.teacher.y + direction[1])),
          },
        });
      } else {
        onRoomChange({
          ...r,
          activeListener: {
            x: Math.max(0.4, Math.min(r.dimensions.width - 0.4, r.activeListener.x + direction[0])),
            y: Math.max(0.4, Math.min(r.dimensions.depth - 0.4, r.activeListener.y + direction[1])),
          },
        });
      }
      return;
    }

    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      onRoomChange({
        ...r,
        teacher: { ...r.teacher, angle: r.teacher.angle + (e.key === ']' ? 1 : -1) * Math.PI / 12 },
      });
    } else if (e.key.toLowerCase() === 'm' && r.wallSegments.length > 0) {
      e.preventDefault();
      const index = keyboardWallIndexRef.current % r.wallSegments.length;
      const wallId = r.wallSegments[index].id;
      keyboardWallIndexRef.current = (index + 1) % r.wallSegments.length;
      onRoomChange({
        ...r,
        wallSegments: r.wallSegments.map((wall) =>
          wall.id === wallId ? { ...wall, material: cycleMaterial(wall.material) } : wall
        ),
      });
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div className="relative w-full h-full select-none">
      {/* ── 3D Viewport Canvas ── */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block touch-none cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-400"
        tabIndex={0}
        role="application"
        aria-label="Interactive classroom canvas"
        aria-describedby="classroom-canvas-keyboard-help"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleCanvasKeyDown}
        onContextMenu={handleContextMenu}
      />
      <span id="classroom-canvas-keyboard-help" className="sr-only">
        Use arrow keys to move the listener, Shift plus arrow keys to move the teacher, brackets to rotate the teacher, and M to cycle wall materials.
      </span>

      {/* ── Interactive Wall Hover Cue & Tooltip ── */}
      {hoveredWall && hoverPos && (
        <div
          className="absolute z-30 pointer-events-none px-2.5 py-1 rounded-md bg-surface-900/90 text-slate-200 border border-accent-500/40 shadow-xl backdrop-blur text-[10px] flex items-center gap-1.5 transition-opacity"
          style={{
            left: `${hoverPos[0] + 12}px`,
            top: `${hoverPos[1] - 25}px`,
          }}
        >
          <span className="font-bold text-accent-400 capitalize">{hoveredWall.material.replace('_', ' ')}:</span>
          <span>Click to cycle material</span>
        </div>
      )}

      {/* ── Quick Camera View Preset Buttons (HUD) ── */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 pointer-events-none">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-800/90 backdrop-blur border border-white/10 shadow-xl pointer-events-auto">
          <button
            onClick={() => applyPreset('isometric')}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activePreset === 'isometric'
                ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/10',
            ].join(' ')}
            title="3D Isometric View"
          >
            <Compass size={13} />
            <span className="hidden sm:inline">3D Orbit</span>
          </button>

          <button
            onClick={() => applyPreset('topdown')}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activePreset === 'topdown'
                ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/10',
            ].join(' ')}
            title="Top-Down Floorplan"
          >
            <Grid size={13} />
            <span className="hidden sm:inline">Top-Down</span>
          </button>

          <button
            onClick={() => applyPreset('teacher')}
            className={[
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activePreset === 'teacher'
                ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                : 'text-slate-400 hover:text-white hover:bg-white/10',
            ].join(' ')}
            title="Teacher Point of View"
          >
            <User size={13} />
            <span className="hidden sm:inline">Teacher POV</span>
          </button>

          <button
            onClick={() => applyPreset('reset')}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            title="Reset Camera View"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClassroomCanvas;
