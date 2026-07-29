import * as THREE from 'three';
import { eventBus, Events } from '../core/EventBus';
import { InputSystem } from '../systems/InputSystem';
import { WorkerPhysicsFacade } from '../systems/PhysicsSystem';
import { VehicleView } from '../render/VehicleView';
import { CockpitWheelView } from '../render/CockpitWheelView';
import { SkidMarks } from '../render/SkidMarks';
import { TireSmoke } from '../render/TireSmoke';
import { EngineAudio } from '../audio/EngineAudio';
import type { CarSetup } from '../game/CarSetup';
import type { WheelTrackContact } from '../game/CompetitionLap';
import type { CameraMode } from '../render/RaceCamera';
import defaultVehicleJson from '../sim/data/defaultVehicle.json';
import defaultWorldJson from '../sim/data/testWorld.json';
import type {
  PhysicsSnapshot,
  MeshSurfaceLayerSpec,
  SurfaceMaterial,
  TerrainTrackSample,
  VehicleSpec,
  WorldSpec,
} from '../sim/types';

type StandaloneCenterline = {
  count: number;
  length: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  tx: ArrayLike<number>;
  tz: ArrayLike<number>;
  nx: ArrayLike<number>;
  nz: ArrayLike<number>;
  grade: ArrayLike<number>;
  bank: ArrayLike<number>;
  curv: ArrayLike<number>;
  hw: ArrayLike<number>;
  s: ArrayLike<number>;
  crossSectionHeight(index: number, lateral?: number, lift?: number): number;
  nearest?(
    x: number,
    z: number,
    hint?: number,
  ): { index: number; s: number; lateral: number; halfWidth: number };
};

type StandaloneSurface = {
  edgeBarrier(index: number, side: number): number;
};

export type StandaloneCarState = {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  kmh: number;
  gear: number;
  rpm: number;
  rpmFrac: number;
  distance: number;
  lateral: number;
  onTrack: boolean;
  surfaceName: string;
  wheelContacts: WheelTrackContact[];
  resetCount: number;
  hint: number;
  ai: false;
  mesh: THREE.Object3D;
  input: { throttle: number; brake: number; steer: number; handbrake: boolean };
  resetTo(station?: number): void;
};

const vehicleSpec = defaultVehicleJson as VehicleSpec;
const redlineRpm = vehicleSpec.engine.redlineRpm;
export const RETTIFILO_ESCAPE_FROM_M = 675;
export const RETTIFILO_ESCAPE_TO_M = 920;
const RETTIFILO_ESCAPE_LENGTH_M = 205;
const RETTIFILO_ESCAPE_ENTRY_WIDTH_M = 10.5;
const RETTIFILO_ESCAPE_END_WIDTH_M = 8;
const RETTIFILO_SURFACE_CROWN_M = 0.028;

export type RettifiloEscapeSurface = {
  layer: MeshSurfaceLayerSpec;
  uvs: number[];
  start: [number, number, number];
  end: [number, number, number];
  width: number;
};

export function buildRettifiloEscapeSurface(centerline: StandaloneCenterline): RettifiloEscapeSurface {
  const start = sampleAtStation(centerline, RETTIFILO_ESCAPE_FROM_M);
  const bankSlope = Math.tan(start.bank);
  const normal = surfaceNormal(
    [start.tx, start.tz],
    [start.nx, start.nz],
    start.grade,
    bankSlope,
  );
  const sections = 12;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let section = 0; section <= sections; section += 1) {
    const t = section / sections;
    const distance = RETTIFILO_ESCAPE_LENGTH_M * t;
    const halfWidth =
      (RETTIFILO_ESCAPE_ENTRY_WIDTH_M
        + (RETTIFILO_ESCAPE_END_WIDTH_M - RETTIFILO_ESCAPE_ENTRY_WIDTH_M) * t)
      * 0.5;
    const x = start.x + start.tx * distance;
    // Match the terrain solver's road crown and crossfall at the join. The old
    // 14 cm render lift was also used for collision, creating a suspension step
    // across the racing line at Turn 1.
    const y = start.y + start.grade * distance + RETTIFILO_SURFACE_CROWN_M;
    const z = start.z + start.tz * distance;
    positions.push(
      x - start.nx * halfWidth, y - halfWidth * bankSlope, z - start.nz * halfWidth,
      x + start.nx * halfWidth, y + halfWidth * bankSlope, z + start.nz * halfWidth,
    );
    normals.push(...normal, ...normal);
    uvs.push(0, t * 12, 1, t * 12);
    if (section < sections) {
      const row = section * 2;
      indices.push(row, row + 1, row + 3, row, row + 3, row + 2);
    }
  }
  const end: [number, number, number] = [
    start.x + start.tx * RETTIFILO_ESCAPE_LENGTH_M,
    start.y + start.grade * RETTIFILO_ESCAPE_LENGTH_M,
    start.z + start.tz * RETTIFILO_ESCAPE_LENGTH_M,
  ];
  return {
    layer: {
      id: 'rettifilo-straight-escape',
      materialId: 'asphalt_new',
      positions,
      indices,
      normals,
    },
    uvs,
    start: [start.x, start.y, start.z],
    end,
    width: RETTIFILO_ESCAPE_ENTRY_WIDTH_M,
  };
}

function sampleAtStation(centerline: StandaloneCenterline, station: number): {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
  tx: number;
  tz: number;
  grade: number;
  bank: number;
} {
  const target = ((station % centerline.length) + centerline.length) % centerline.length;
  let index = 0;
  while (index + 1 < centerline.count && centerline.s[index + 1] <= target) index += 1;
  const next = (index + 1) % centerline.count;
  const s0 = centerline.s[index];
  const s1 = next === 0 ? centerline.length : centerline.s[next];
  const t = Math.max(0, Math.min(1, (target - s0) / Math.max(1e-6, s1 - s0)));
  let nx = centerline.nx[index] + (centerline.nx[next] - centerline.nx[index]) * t;
  let nz = centerline.nz[index] + (centerline.nz[next] - centerline.nz[index]) * t;
  const normalLength = Math.hypot(nx, nz) || 1;
  nx /= normalLength;
  nz /= normalLength;
  return {
    x: centerline.x[index] + (centerline.x[next] - centerline.x[index]) * t,
    y: centerline.y[index] + (centerline.y[next] - centerline.y[index]) * t,
    z: centerline.z[index] + (centerline.z[next] - centerline.z[index]) * t,
    nx,
    nz,
    tx: centerline.tx[index] + (centerline.tx[next] - centerline.tx[index]) * t,
    tz: centerline.tz[index] + (centerline.tz[next] - centerline.tz[index]) * t,
    grade: centerline.grade[index] + (centerline.grade[next] - centerline.grade[index]) * t,
    bank: centerline.bank[index] + (centerline.bank[next] - centerline.bank[index]) * t,
  };
}

export function buildStandaloneMonzaWorld(
  centerline: StandaloneCenterline,
  surface: StandaloneSurface,
  barrierStride = 8,
): WorldSpec {
  const samples: TerrainTrackSample[] = [];
  let halfWidthTotal = 0;
  for (let i = 0; i < centerline.count; i += 1) {
    const tangent: [number, number] = [centerline.tx[i], centerline.tz[i]];
    const lateral: [number, number] = [centerline.nx[i], centerline.nz[i]];
    const grade = centerline.grade[i];
    const bankSlope = Math.tan(centerline.bank[i]);
    samples.push({
      pos: [centerline.x[i], centerline.z[i]],
      tangent,
      left: lateral,
      normal: surfaceNormal(tangent, lateral, grade, bankSlope),
      curvature: centerline.curv[i],
      s: centerline.s[i],
      realS: centerline.s[i],
      elevation: centerline.y[i],
      camber: centerline.bank[i],
      sector: 'Monza',
    });
    halfWidthTotal += centerline.hw[i];
  }

  const stride = Math.max(1, Math.floor(barrierStride));
  const barriers = buildOptimizedBoundaryColliders(centerline, surface, stride);

  return {
    gravity: defaultWorldJson.gravity,
    defaultMaterialId: defaultWorldJson.defaultMaterialId as WorldSpec['defaultMaterialId'],
    materials: defaultWorldJson.materials as SurfaceMaterial[],
    zones: [],
    barriers,
    meshSurface: {
      cellSize: 16,
      layers: [buildRettifiloEscapeSurface(centerline).layer],
    },
    terrainTrack: {
      samples,
      halfWidth: halfWidthTotal / Math.max(1, centerline.count),
      shoulderWidth: 28,
    },
    spawn: {
      position: [
        centerline.x[0],
        centerline.crossSectionHeight(0, 0, 0.72),
        centerline.z[0],
      ],
      yawRad: Math.atan2(centerline.tx[0], centerline.tz[0]),
    },
  };
}

const BOUNDARY_HALF_THICKNESS_M = 0.18;
const BOUNDARY_HALF_HEIGHT_M = 0.72;
const BOUNDARY_CHORD_OVERLAP_M = 0.08;
const BOUNDARY_MAX_CHORD_ERROR_M = 0.16;

/**
 * Builds a low-count chain of thin boxes directly on the rendered boundary
 * polyline. Each box is centred and oriented from its two endpoints, avoiding
 * the old start-anchored boxes that cut inward across bends.
 */
export function buildOptimizedBoundaryColliders(
  centerline: StandaloneCenterline,
  surface: StandaloneSurface,
  maxStride = 8,
): NonNullable<WorldSpec['barriers']> {
  const barriers: NonNullable<WorldSpec['barriers']> = [];
  const stride = Math.max(1, Math.floor(maxStride));
  let start = 0;

  while (start < centerline.count) {
    let end = Math.min(centerline.count, start + stride);
    while (
      end > start + 1
      && boundaryChordError(centerline, surface, start, end) > BOUNDARY_MAX_CHORD_ERROR_M
    ) {
      end -= 1;
    }

    for (const side of [0, 1]) {
      if (boundaryIntervalIsOpen(centerline, start, end, side)) continue;
      const from = boundaryPoint(centerline, surface, start, side);
      const to = boundaryPoint(centerline, surface, end, side);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const chordLength = Math.hypot(dx, dz);
      if (chordLength < 0.05) continue;
      barriers.push({
        id: `monza-boundary-${side}-${start}-${end}`,
        center: [
          (from.x + to.x) * 0.5,
          (from.y + to.y) * 0.5,
          (from.z + to.z) * 0.5,
        ],
        halfExtents: [
          BOUNDARY_HALF_THICKNESS_M,
          BOUNDARY_HALF_HEIGHT_M,
          chordLength * 0.5 + BOUNDARY_CHORD_OVERLAP_M,
        ],
        yawRad: Math.atan2(dx, dz),
        kind: 'armco',
      });
    }
    start = end;
  }

  return barriers;
}

function boundaryPoint(
  centerline: StandaloneCenterline,
  surface: StandaloneSurface,
  unwrappedIndex: number,
  side: number,
): { x: number; y: number; z: number } {
  const index = unwrappedIndex % centerline.count;
  const lateral = surface.edgeBarrier(index, side) * (side === 0 ? -1 : 1);
  return {
    x: centerline.x[index] + centerline.nx[index] * lateral,
    y: centerline.crossSectionHeight(index, lateral, BOUNDARY_HALF_HEIGHT_M),
    z: centerline.z[index] + centerline.nz[index] * lateral,
  };
}

function boundaryChordError(
  centerline: StandaloneCenterline,
  surface: StandaloneSurface,
  start: number,
  end: number,
): number {
  let maxError = 0;
  for (const side of [0, 1]) {
    const from = boundaryPoint(centerline, surface, start, side);
    const to = boundaryPoint(centerline, surface, end, side);
    for (let index = start + 1; index < end; index += 1) {
      const point = boundaryPoint(centerline, surface, index, side);
      maxError = Math.max(maxError, pointToSegmentDistance(point.x, point.z, from.x, from.z, to.x, to.z));
    }
  }
  return maxError;
}

function pointToSegmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 1e-8) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function boundaryIntervalIsOpen(
  centerline: StandaloneCenterline,
  start: number,
  end: number,
  _side: number,
): boolean {
  const startStation = centerline.s[start % centerline.count];
  const endStation = end === centerline.count
    ? centerline.length
    : centerline.s[end % centerline.count];
  const openingStart = RETTIFILO_ESCAPE_FROM_M - 20;
  const openingEnd = RETTIFILO_ESCAPE_TO_M + 20;
  return startStation < openingEnd && endStation > openingStart;
}

/**
 * Adapts the main simulator's worker snapshots to the standalone Monza camera
 * and HUD contracts while keeping the physics transform authoritative.
 */
export class MonzaVehicleSim {
  readonly kind = 'Vehicle Sim worker dynamics';
  readonly version = 'v0.1';
  readonly world: WorldSpec;
  readonly car: StandaloneCarState;
  ready = false;

  private readonly physics = new WorkerPhysicsFacade();
  private readonly input: InputSystem;
  private readonly view: VehicleView;
  private readonly cockpitView: CockpitWheelView;
  private readonly skidMarks = new SkidMarks();
  private readonly tireSmoke = new TireSmoke();
  private readonly audio = new EngineAudio();
  private readonly unsubs: Array<() => void> = [];
  private lastSnapshot: PhysicsSnapshot | null = null;
  private resetSeed = 100;
  private cameraMode: CameraMode = 'onboard';
  private vehicleVisible = true;

  constructor(
    private readonly context: {
      centerline: StandaloneCenterline;
      surface: StandaloneSurface;
      scene: THREE.Scene;
      inputElement: HTMLElement;
    },
  ) {
    this.world = buildStandaloneMonzaWorld(context.centerline, context.surface);
    this.input = new InputSystem(context.inputElement);
    this.view = new VehicleView(vehicleSpec, context.scene.environment);
    this.cockpitView = new CockpitWheelView(context.scene.environment);
    this.car = createCarAdapter(() => this.reset());
  }

  async init(): Promise<this> {
    await this.physics.init(this.world);
    await this.physics.createVehicle(vehicleSpec);
    this.context.scene.add(
      this.view.group,
      this.cockpitView.group,
      this.skidMarks.mesh,
      this.tireSmoke.points,
    );
    this.unsubs.push(
      eventBus.on(Events.SIM_RESET_REQUESTED, () => this.reset()),
      eventBus.on(Events.AUDIO_TOGGLE_REQUESTED, () => this.audio.toggleMuted()),
    );
    this.ready = true;
    return this;
  }

  update(nowMs: number, deltaSeconds: number): StandaloneCarState {
    if (!this.ready) return this.car;
    this.physics.submitInput(this.input.update(nowMs));
    this.physics.step(nowMs);
    const snapshot = this.physics.getSnapshot();
    if (!snapshot || snapshot === this.lastSnapshot) return this.car;
    this.lastSnapshot = snapshot;
    this.view.applySnapshot(snapshot, Math.max(0, deltaSeconds));
    this.cockpitView.applySnapshot(snapshot);
    this.skidMarks.update(snapshot);
    this.tireSmoke.update(snapshot, Math.max(0, deltaSeconds));
    this.audio.update(snapshot.telemetry, Math.max(0, deltaSeconds));
    this.applySnapshot(snapshot);
    return this.car;
  }

  isAutoShift(): boolean {
    return this.input.isAutoShift();
  }

  toggleTransmission(): boolean {
    const next = !this.input.isAutoShift();
    this.input.setAutoShift(next);
    return next;
  }

  applySetup(setup: CarSetup): void {
    this.physics.applySetup(setup.physics);
    this.input.applyInputSetup(setup.input);
    this.input.setAutoShift(setup.autoShift);
  }

  setCameraMode(mode: string): void {
    // Every camera except COCKPIT looks at the car from outside, so it must show
    // the bodywork and hide the cockpit-interior view. Matching only 'NOSE' here
    // left TV / HELICOPTER / ORBIT falling through to the onboard branch, which
    // rendered the steering wheel and dashboard floating in mid-air with no car.
    this.cameraMode = mode === 'COCKPIT' ? 'onboard' : 'nose';
    this.updateVehicleVisibility();
  }

  setVehicleVisible(visible: boolean): void {
    this.vehicleVisible = visible;
    this.updateVehicleVisibility();
  }

  effectsStatus(): { audio: boolean; skidMarks: boolean; tireSmoke: boolean } {
    return {
      audio: true,
      skidMarks: this.context.scene.getObjectByName('skid-marks') === this.skidMarks.mesh,
      tireSmoke: this.context.scene.getObjectByName('tire-smoke') === this.tireSmoke.points,
    };
  }

  reset(): void {
    this.resetSeed += 1;
    this.car.resetCount += 1;
    this.physics.reset(this.resetSeed);
    this.skidMarks.clear();
  }

  dispose(): void {
    this.input.dispose();
    this.physics.dispose();
    this.view.dispose();
    this.cockpitView.dispose();
    this.skidMarks.dispose();
    this.tireSmoke.dispose();
    this.audio.dispose();
    this.context.scene.remove(
      this.view.group,
      this.cockpitView.group,
      this.skidMarks.mesh,
      this.tireSmoke.points,
    );
    for (const unsub of this.unsubs) unsub();
  }

  private applySnapshot(snapshot: PhysicsSnapshot): void {
    const { car } = this;
    car.pos.set(
      snapshot.chassis.position[0],
      snapshot.chassis.position[1],
      snapshot.chassis.position[2],
    );
    const quaternion = new THREE.Quaternion(
      snapshot.chassis.orientation[0],
      snapshot.chassis.orientation[1],
      snapshot.chassis.orientation[2],
      snapshot.chassis.orientation[3],
    );
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    car.yaw = Math.atan2(forward.x, forward.z);
    car.pitch = euler.x;
    car.roll = euler.z;
    car.mesh.quaternion.copy(quaternion);
    car.speed = snapshot.telemetry.speedMps;
    car.kmh = snapshot.telemetry.speedMps * 3.6;
    car.gear = snapshot.telemetry.gear;
    car.rpm = snapshot.telemetry.rpm;
    car.rpmFrac = Math.min(1, snapshot.telemetry.rpm / redlineRpm);
    const nearest = this.context.centerline.nearest?.(car.pos.x, car.pos.z, car.hint);
    if (nearest) {
      car.hint = nearest.index;
      car.distance = nearest.s;
      car.lateral = nearest.lateral;
      car.onTrack = Math.abs(nearest.lateral) <= nearest.halfWidth + 1.15;
      car.surfaceName = surfaceName(snapshot);
    }
    car.wheelContacts = Object.values(snapshot.telemetry.wheels).map((wheel) => ({
      contact: wheel.contact,
      surfaceMaterialId: wheel.surfaceMaterialId,
    }));
  }

  private updateVehicleVisibility(): void {
    this.view.group.visible = this.vehicleVisible && this.cameraMode === 'nose';
    this.view.setCameraMode(this.cameraMode);
    this.cockpitView.setCameraMode(
      this.vehicleVisible && this.cameraMode === 'onboard' ? 'onboard' : 'nose',
    );
  }
}

function createCarAdapter(reset: () => void): StandaloneCarState {
  return {
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    kmh: 0,
    gear: 0,
    rpm: 0,
    rpmFrac: 0,
    distance: 0,
    lateral: 0,
    onTrack: true,
    surfaceName: 'track',
    wheelContacts: Array.from({ length: 4 }, () => ({
      contact: true,
      surfaceMaterialId: 'asphalt_new' as const,
    })),
    resetCount: 0,
    hint: 0,
    ai: false,
    mesh: new THREE.Object3D(),
    input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    resetTo: () => reset(),
  };
}

function surfaceNormal(
  tangent: [number, number],
  lateral: [number, number],
  grade: number,
  bankSlope: number,
): [number, number, number] {
  const nx = bankSlope * tangent[1] - lateral[1] * grade;
  const ny = lateral[1] * tangent[0] - lateral[0] * tangent[1];
  const nz = lateral[0] * grade - bankSlope * tangent[0];
  const length = Math.hypot(nx, ny, nz) || 1;
  const sign = ny < 0 ? -1 : 1;
  return [nx / length * sign, ny / length * sign, nz / length * sign];
}

function surfaceName(snapshot: PhysicsSnapshot): string {
  const materials = Object.values(snapshot.telemetry.wheels)
    .filter((wheel) => wheel.contact)
    .map((wheel) => wheel.surfaceMaterialId);
  if (materials.includes('gravel')) return 'gravel';
  if (materials.includes('grass')) return 'grass';
  if (materials.includes('kerb')) return 'kerb';
  return 'track';
}
