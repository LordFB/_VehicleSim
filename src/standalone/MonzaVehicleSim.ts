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
import type { CameraMode } from '../render/RaceCamera';
import defaultVehicleJson from '../sim/data/defaultVehicle.json';
import defaultWorldJson from '../sim/data/testWorld.json';
import type {
  PhysicsSnapshot,
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
  hint: number;
  ai: false;
  mesh: THREE.Object3D;
  input: { throttle: number; brake: number; steer: number; handbrake: boolean };
  resetTo(station?: number): void;
};

const vehicleSpec = defaultVehicleJson as VehicleSpec;
const redlineRpm = vehicleSpec.engine.redlineRpm;

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
  const barriers: NonNullable<WorldSpec['barriers']> = [];
  for (let i = 0; i < centerline.count;) {
    // Long boxes are cheap and continuous on straights; tighter corners use
    // shorter chords so their physical edge stays on top of the visible rail.
    const segmentStride =
      stride >= 6 && Math.abs(centerline.curv[i]) > 0.008
        ? Math.max(4, Math.floor(stride / 2))
        : stride;
    const next = (i + segmentStride) % centerline.count;
    const segmentLength = cyclicStationDelta(centerline.s[next], centerline.s[i], centerline.length);
    const yawRad = Math.atan2(centerline.tx[i], centerline.tz[i]);
    for (const side of [0, 1]) {
      const lateral = surface.edgeBarrier(i, side) * (side === 0 ? -1 : 1);
      barriers.push({
        id: `monza-edge-${side}-${i}`,
        center: [
          centerline.x[i] + centerline.nx[i] * lateral,
          centerline.crossSectionHeight(i, lateral, 0.72),
          centerline.z[i] + centerline.nz[i] * lateral,
        ],
        halfExtents: [0.22, 0.72, Math.max(1.25, segmentLength * 0.55)],
        yawRad,
        kind: 'armco',
      });
    }
    i += segmentStride;
  }

  return {
    gravity: defaultWorldJson.gravity,
    defaultMaterialId: defaultWorldJson.defaultMaterialId as WorldSpec['defaultMaterialId'],
    materials: defaultWorldJson.materials as SurfaceMaterial[],
    zones: [],
    barriers,
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
  private cameraMode: CameraMode = 'chase';
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
    this.cameraMode = mode === 'COCKPIT' ? 'onboard' : mode === 'NOSE' ? 'nose' : 'chase';
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
  }

  private updateVehicleVisibility(): void {
    this.view.group.visible = this.vehicleVisible && this.cameraMode !== 'onboard';
    this.cockpitView.setCameraMode(
      this.vehicleVisible && this.cameraMode === 'onboard' ? 'onboard' : 'chase',
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

function cyclicStationDelta(next: number, current: number, length: number): number {
  const delta = next - current;
  return delta > 0 ? delta : length - current + next;
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
