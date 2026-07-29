export type RaceVehicleId = string;
export type RaceMode = 'participate' | 'watch';
export type RacePhase = 'countdown' | 'running' | 'finished';
export type RaceFidelity = 'full' | 'simplified';
export type DamageComponentId =
  | 'frontWing'
  | 'rearWing'
  | 'frontLeftSuspension'
  | 'frontRightSuspension'
  | 'rearLeftSuspension'
  | 'rearRightSuspension'
  | 'frontLeftTire'
  | 'frontRightTire'
  | 'rearLeftTire'
  | 'rearRightTire'
  | 'engine'
  | 'gearbox'
  | 'chassis';

export type RaceDamageState = {
  health: Record<DamageComponentId, number>;
  totalDamage: number;
  punctures: WheelId[];
  retired: boolean;
  lastImpact: {
    source: 'barrier' | 'vehicle';
    deltaSpeedMps: number;
    severity: number;
    component: DamageComponentId | null;
    timeMs: number;
  } | null;
};

export type RaceCourseSample = {
  stationM: number;
  position: [number, number, number];
  tangent: [number, number];
  targetSpeedMps: number;
  brakeTargetSpeedMps: number;
  curvature: number;
  cornerName: string | null;
  halfWidthM: number;
  racingLineOffsetM: number;
};

export type RaceCourseSpec = {
  lengthM: number;
  samples: RaceCourseSample[];
};

export type RaceVehicleSpec = {
  id: RaceVehicleId;
  driverName: string;
  gridPosition: number;
  ai: boolean;
  pace: number;
};

export type RaceSessionSpec = {
  mode: RaceMode;
  lapCount: number;
  countdownMs: number;
  course: RaceCourseSpec;
  playerVehicleId: RaceVehicleId | null;
  vehicles: RaceVehicleSpec[];
  world?: WorldSpec;
  vehicle?: VehicleSpec;
};

export type RaceVehicleInput = {
  vehicleId: RaceVehicleId;
  throttle: number;
  brake: number;
  steering: number;
  reset: boolean;
};

export type RaceVehicleSnapshot = {
  id: RaceVehicleId;
  driverName: string;
  ai: boolean;
  position: number;
  worldPosition: [number, number, number];
  yawRad: number;
  speedMps: number;
  stationM: number;
  lateralM: number;
  lateralSpeedMps: number;
  targetLateralM: number;
  completedLaps: number;
  fidelity: RaceFidelity;
  physicsModel?: 'full' | 'ai-tire' | 'kinematic';
  penaltyMs: number;
  ghostMs: number;
  contactCount: number;
  finished: boolean;
  finishTimeMs: number | null;
  physicsSnapshot?: PhysicsSnapshot;
  aiSensor?: {
    targetSpeedMps: number;
    distanceM: number;
    cornerName: string | null;
    trafficGapM: number | null;
  };
  damage?: RaceDamageState;
  retired?: boolean;
};

export type RaceClassificationEntry = {
  position: number;
  vehicleId: RaceVehicleId;
  driverName: string;
  completedLaps: number;
  elapsedMs: number;
  penaltyMs: number;
  totalMs: number;
  finished: boolean;
  retired?: boolean;
};

export type RaceSnapshot = {
  sequence: number;
  simTimeMs: number;
  raceTimeMs: number;
  countdownMs: number;
  phase: RacePhase;
  mode: RaceMode;
  lapCount: number;
  focusedVehicleId: RaceVehicleId;
  vehicles: RaceVehicleSnapshot[];
  classification: RaceClassificationEntry[];
};

export type RaceWorkerRequest =
  | { type: 'init'; spec: RaceSessionSpec }
  | { type: 'step'; deltaMs: number; inputs: RaceVehicleInput[] }
  | { type: 'focus'; vehicleId: RaceVehicleId };

export type RaceWorkerResponse =
  | { type: 'ready'; snapshot: RaceSnapshot }
  | { type: 'snapshot'; snapshot: RaceSnapshot }
  | { type: 'error'; message: string };
import type { PhysicsSnapshot, VehicleSpec, WheelId, WorldSpec } from '../sim/types';
