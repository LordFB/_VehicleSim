import * as THREE from 'three';
import defaultVehicleJson from '../sim/data/defaultVehicle.json';
import type { PhysicsSnapshot, VehicleSpec } from '../sim/types';
import { VehicleView } from '../render/VehicleView';
import { buildStandaloneMonzaWorld } from '../standalone/MonzaVehicleSim';
import type { RaceMode, RaceSessionSpec, RaceSnapshot, RaceVehicleInput } from './types';
import { RacePhysicsFacade } from './RacePhysicsFacade';

type Centerline = {
  count: number;
  length: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  z: ArrayLike<number>;
  tx: ArrayLike<number>;
  tz: ArrayLike<number>;
  hw: ArrayLike<number>;
  s: ArrayLike<number>;
  corners?: Array<{ start: number; end: number; name: string; label?: string; radius: number }>;
};

type InputState = {
  throttle: number;
  brake: number;
  steering: number;
  reset: boolean;
};

type RacingLine = {
  at(stationM: number): { offset: number; speed: number; curvature: number };
};

type Surface = {
  edgeBarrier(index: number, side: number): number;
};

const vehicleSpec = defaultVehicleJson as VehicleSpec;

const DRIVER_NAMES = [
  'A. Rossi', 'M. Bianchi', 'L. Romano', 'S. Conti', 'E. Moretti', 'Player',
  'G. Ferrari', 'D. Ricci', 'N. Gallo', 'P. Costa', 'F. Marino', 'T. Lombardi',
];

export class MonzaRaceSession {
  readonly kind = 'Vehicle Sim deterministic multi-car race worker';
  readonly version = 'v0.1';
  readonly car: {
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
    wheelContacts: Array<{ contact: boolean; surfaceMaterialId: string }>;
    resetCount: number;
    hint: number;
    ai: boolean;
    mesh: THREE.Object3D;
    input: { throttle: number; brake: number; steer: number; handbrake: boolean };
    resetTo: () => void;
  };
  ready = false;

  private readonly facade = new RacePhysicsFacade();
  private readonly group = new THREE.Group();
  private readonly views = new Map<string, VehicleView>();
  private readonly keys = new Set<string>();
  private readonly input: InputState = { throttle: 0, brake: 0, steering: 0, reset: false };
  private readonly playerId: string | null;
  private snapshotState: RaceSnapshot | null = null;
  private lastUpdateMs: number | null = null;
  private focusPoseInitialized = false;
  private renderedFocusYaw = 0;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (event.code === 'KeyR' && this.playerId) this.input.reset = true;
    if (event.code === 'BracketRight' || event.code === 'BracketLeft') {
      this.cycleFocus(event.code === 'BracketRight' ? 1 : -1);
    }
  };
  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  constructor(
    private readonly context: {
      centerline: Centerline;
      racingLine: RacingLine;
      surface: Surface;
      scene: THREE.Scene;
      mode: RaceMode;
    },
  ) {
    this.playerId = context.mode === 'participate' ? 'car-6' : null;
    this.group.name = 'race-grid';
    this.context.scene.add(this.group);
    for (let index = 0; index < 12; index += 1) {
      const view = new VehicleView(vehicleSpec, context.scene.environment);
      view.group.name = `race-car-${index + 1}`;
      tintRaceCar(view.group, index);
      this.views.set(`car-${index + 1}`, view);
      this.group.add(view.group);
    }
    const focus = this.views.get(this.playerId ?? 'car-6')!.group;
    this.car = {
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      roll: 0,
      speed: 0,
      kmh: 0,
      gear: 1,
      rpm: 2_000,
      rpmFrac: 0.2,
      distance: 0,
      lateral: 0,
      onTrack: true,
      surfaceName: 'track',
      wheelContacts: [],
      resetCount: 0,
      hint: 0,
      ai: context.mode === 'watch',
      mesh: focus,
      input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      resetTo: () => { this.input.reset = true; },
    };
  }

  async init(): Promise<this> {
    this.snapshotState = await this.facade.init(buildRaceSpec(
      this.context.centerline,
      this.context.surface,
      this.context.racingLine,
      this.context.mode,
    ));
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    this.applySnapshot(this.snapshotState);
    this.ready = true;
    return this;
  }

  update(nowMs: number, deltaSeconds: number): typeof this.car {
    if (!this.ready) return this.car;
    const inputs: RaceVehicleInput[] = [];
    if (this.playerId) {
      this.input.throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
      this.input.brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
      this.input.steering =
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
        - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      inputs.push({
        vehicleId: this.playerId,
        throttle: this.input.throttle,
        brake: this.input.brake,
        steering: -this.input.steering,
        reset: this.input.reset,
      });
      this.input.reset = false;
    }
    // The outer renderer deliberately caps its frame delta. That is useful for
    // single-car numerical stability, but a throttled render loop must not make
    // a race countdown or AI race run in slow motion. The race worker has its
    // own fixed-step accumulator and bounded message chunks, so feed it elapsed
    // wall time while retaining deltaSeconds for deterministic advanceTime().
    const elapsedSeconds = this.lastUpdateMs === null
      ? deltaSeconds
      : Math.max(deltaSeconds, (nowMs - this.lastUpdateMs) / 1000);
    this.lastUpdateMs = nowMs;
    this.facade.step(Math.min(1, Math.max(0, elapsedSeconds)) * 1000, inputs);
    const snapshot = this.facade.snapshot();
    if (snapshot && snapshot.sequence !== this.snapshotState?.sequence) {
      this.snapshotState = snapshot;
    }
    if (this.snapshotState) this.applySnapshot(this.snapshotState, deltaSeconds);
    return this.car;
  }

  raceSnapshot(): RaceSnapshot | null {
    return this.snapshotState;
  }

  isAutoShift(): boolean { return true; }
  toggleTransmission(): boolean { return true; }
  applySetup(): void {}
  setCameraMode(): void {}
  setVehicleVisible(visible: boolean): void { this.group.visible = visible; }
  effectsStatus(): { audio: boolean; skidMarks: boolean; tireSmoke: boolean } {
    return { audio: false, skidMarks: false, tireSmoke: false };
  }

  reset(): void {
    if (this.playerId) this.input.reset = true;
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    this.facade.dispose();
    this.context.scene.remove(this.group);
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
  }

  private cycleFocus(direction: number): void {
    const current = this.snapshotState?.focusedVehicleId ?? 'car-6';
    const index = Math.max(0, Number(current.split('-')[1]) - 1);
    const next = (index + direction + 12) % 12;
    this.focusPoseInitialized = false;
    this.facade.focus(`car-${next + 1}`);
  }

  private applySnapshot(snapshot: RaceSnapshot, deltaSeconds = 1 / 60): void {
    for (const vehicle of snapshot.vehicles) {
      const view = this.views.get(vehicle.id);
      if (!view || !vehicle.physicsSnapshot) continue;
      view.applySnapshot(vehicle.physicsSnapshot, deltaSeconds);
      view.group.visible = true;
    }
    const focusId = this.playerId ?? snapshot.focusedVehicleId;
    const focus = snapshot.vehicles.find((vehicle) => vehicle.id === focusId) ?? snapshot.vehicles[0];
    const focusView = this.views.get(focus.id)!;
    const targetPosition = new THREE.Vector3().fromArray(focus.worldPosition);
    if (!this.focusPoseInitialized) {
      this.car.pos.copy(targetPosition);
      this.renderedFocusYaw = focus.yawRad;
      this.focusPoseInitialized = true;
    } else {
      const alpha = 1 - Math.pow(1 - 0.42, Math.max(0, deltaSeconds) * 60);
      this.car.pos.lerp(targetPosition, alpha);
      this.renderedFocusYaw += wrapAngle(focus.yawRad - this.renderedFocusYaw) * alpha;
    }
    this.car.mesh = focusView.group;
    this.car.yaw = this.renderedFocusYaw;
    this.car.speed = focus.speedMps;
    this.car.kmh = focus.speedMps * 3.6;
    this.car.gear = Math.max(1, Math.min(7, Math.ceil(focus.speedMps / 12)));
    this.car.rpmFrac = Math.min(1, 0.18 + focus.speedMps / 92 * 0.82);
    this.car.rpm = 1_500 + this.car.rpmFrac * 7_500;
    this.car.distance = focus.stationM;
    this.car.lateral = focus.lateralM;
    this.car.ai = focus.ai;
    this.car.wheelContacts = focus.physicsSnapshot
      ? Object.values(focus.physicsSnapshot.telemetry.wheels).map((wheel) => ({
          contact: wheel.contact,
          surfaceMaterialId: wheel.surfaceMaterialId,
        }))
      : [];
    this.car.surfaceName = raceSurfaceName(focus.physicsSnapshot);
  }
}

function buildRaceSpec(
  centerline: Centerline,
  surface: Surface,
  racingLine: RacingLine,
  mode: RaceMode,
): RaceSessionSpec {
  const stride = Math.max(1, Math.floor(centerline.count / 420));
  const samples = [];
  for (let index = 0; index < centerline.count; index += stride) {
    const line = racingLine.at(centerline.s[index]);
    const curvature = Number.isFinite(line.curvature) ? line.curvature : 0;
    const tireCornerSpeed = Math.sqrt(1.65 * 9.81 / Math.max(Math.abs(curvature), 1e-5));
    const targetSpeedMps = Math.max(
      16,
      Math.min(88, Number.isFinite(line.speed) ? line.speed : 65, tireCornerSpeed),
    );
    const corner = centerline.corners?.find((candidate) =>
      stationInRange(centerline.s[index], candidate.start, candidate.end, centerline.length)
    );
    samples.push({
      stationM: centerline.s[index],
      position: [centerline.x[index], centerline.y[index] + 0.72, centerline.z[index]] as [number, number, number],
      tangent: [centerline.tx[index], centerline.tz[index]] as [number, number],
      targetSpeedMps,
      brakeTargetSpeedMps: targetSpeedMps,
      curvature,
      cornerName: corner?.label || corner?.name || null,
      halfWidthM: Math.max(5, centerline.hw[index] - 0.8),
      racingLineOffsetM: Math.max(
        -centerline.hw[index] + 1.5,
        Math.min(centerline.hw[index] - 1.5, line.offset),
      ),
    });
  }
  return {
    mode,
    lapCount: 3,
    countdownMs: 3_000,
    course: { lengthM: centerline.length, samples },
    playerVehicleId: mode === 'participate' ? 'car-6' : null,
    world: buildStandaloneMonzaWorld(centerline as never, surface, 8),
    vehicle: vehicleSpec,
    vehicles: Array.from({ length: 12 }, (_, index) => ({
      id: `car-${index + 1}`,
      driverName: mode === 'participate' && index === 5 ? 'Player' : DRIVER_NAMES[index],
      gridPosition: index + 1,
      ai: mode === 'watch' || index !== 5,
      pace: 0.955 + index * 0.004,
    })),
  };
}

function stationInRange(station: number, start: number, end: number, length: number): boolean {
  const s = ((station % length) + length) % length;
  const a = ((start % length) + length) % length;
  const b = ((end % length) + length) % length;
  return a <= b ? s >= a && s <= b : s >= a || s <= b;
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function tintRaceCar(group: THREE.Group, index: number): void {
  const tint = new THREE.Color().setHSL(index / 12, 0.7, 0.52);
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    if (object.material.color.getHex() === 0xe23232) object.material.color.copy(tint);
  });
}

function raceSurfaceName(snapshot: PhysicsSnapshot | undefined): string {
  if (!snapshot) return 'track';
  const materials = Object.values(snapshot.telemetry.wheels)
    .filter((wheel) => wheel.contact)
    .map((wheel) => wheel.surfaceMaterialId);
  if (materials.includes('gravel')) return 'gravel';
  if (materials.includes('grass')) return 'grass';
  if (materials.includes('kerb')) return 'kerb';
  return 'track';
}
