export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export type WheelId = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';

export type Pose = {
  position: Vec3Tuple;
  orientation: QuatTuple;
};

export type SurfaceMaterialId =
  | 'asphalt_new'
  | 'painted_line'
  | 'kerb'
  | 'grass'
  | 'gravel'
  | 'ice';

export type SurfaceMaterial = {
  id: SurfaceMaterialId;
  muLongitudinal: number;
  muLateral: number;
  roughness: number;
  wetness: number;
  temperatureC: number;
  rubberLevel: number;
  rollingResistance: number;
};

export type SurfaceContact = {
  point: Vec3Tuple;
  normal: Vec3Tuple;
  depth: number;
  materialId: SurfaceMaterialId;
  muLongitudinal: number;
  muLateral: number;
  roughness: number;
  wetness: number;
  temperatureC: number;
  rubberLevel: number;
  gravelDepth: number;
};

export type SurfaceZoneSpec = {
  id: string;
  materialId: SurfaceMaterialId;
  type: 'rect' | 'circle' | 'ring';
  center: [number, number];
  size?: [number, number];
  radius?: number;
  innerRadius?: number;
  heightOffset?: number;
};

export type TerrainTrackSample = {
  pos: [number, number];
  tangent: [number, number];
  left: [number, number];
  normal: Vec3Tuple;
  curvature: number;
  s: number;
  realS?: number;
  elevation: number;
  camber: number;
  sector?: string;
};

export type TerrainTrackSpec = {
  samples: TerrainTrackSample[];
  halfWidth: number;
  shoulderWidth: number;
};

export type MeshSurfaceLayerSpec = {
  id: string;
  materialId: SurfaceMaterialId;
  positions: number[];
  indices: number[];
  normals?: number[];
};

export type MeshSurfaceSpec = {
  layers: MeshSurfaceLayerSpec[];
  cellSize?: number;
};

export type BarrierKind = 'armco' | 'solid' | 'tirewall';

export type BarrierSpec = {
  id: string;
  center: Vec3Tuple;
  halfExtents: Vec3Tuple;
  yawRad?: number;
  /** Visual style. Omitted defaults to 'armco' (the existing guardrail look). */
  kind?: BarrierKind;
};

export type WorldSpec = {
  gravity: number;
  defaultMaterialId: SurfaceMaterialId;
  materials: SurfaceMaterial[];
  zones: SurfaceZoneSpec[];
  barriers: BarrierSpec[];
  terrainTrack?: TerrainTrackSpec;
  meshSurface?: MeshSurfaceSpec;
  spawn?: {
    position: Vec3Tuple;
    yawRad: number;
  };
};

export type CurvePoint = [number, number];

export type TireSpec = {
  radius: number;
  width: number;
  mass: number;
  longitudinalStiffness: number;
  corneringStiffness: number;
  camberStiffness: number;
  relaxationLengthLongitudinal: number;
  relaxationLengthLateral: number;
  loadSensitivity: number;
  pneumaticTrail: number;
  rollingResistanceScale: number;
  optimalTempC: number;
  coldMuScale: number;
  overheatMuScale: number;
  wearRate: number;
};

export type SuspensionSpec = {
  restLength: number;
  droopLimit: number;
  springRate: number;
  damperBump: number;
  damperRebound: number;
  bumpStopLength: number;
  bumpStopRate: number;
  antiRollRate: number;
  motionRatio: number;
  camberCurve: CurvePoint[];
  toeCurve: CurvePoint[];
  unsprungMass: number;
};

export type WheelSpec = {
  id: WheelId;
  localPosition: Vec3Tuple;
  steer: boolean;
  drive: boolean;
  brakeBias: number;
  tire: TireSpec;
  suspension: SuspensionSpec;
  inertia: number;
};

export type EngineSpec = {
  idleRpm: number;
  redlineRpm: number;
  inertia: number;
  torqueCurve: CurvePoint[];
  throttleResponse: number;
  engineBrakingTorque: number;
};

export type DrivetrainSpec = {
  clutchTorqueCapacity: number;
  gearRatios: number[];
  /** Reverse-gear ratio (magnitude). Defaults to the 1st-gear ratio if omitted. */
  reverseRatio?: number;
  finalDrive: number;
  differential: 'open';
  drivetrainEfficiency: number;
  autoShift: boolean;
  shiftUpRpm: number;
  shiftDownRpm: number;
};

export type BrakeSpec = {
  maxTorque: number;
  handbrakeTorque: number;
  fadeStartC: number;
  fadeEndC: number;
  heatCapacity: number;
  coolingRate: number;
  ambientTempC: number;
};

export type AeroSpec = {
  airDensity: number;
  dragArea: number;
  liftArea: number;
  centerOfPressure: Vec3Tuple;
};

export type VehicleSpec = {
  name: string;
  chassis: {
    mass: number;
    centerOfMass: Vec3Tuple;
    inertia: Vec3Tuple;
    dimensions: Vec3Tuple;
  };
  steering: {
    maxAngleRad: number;
    responseRate: number;
  };
  wheels: WheelSpec[];
  engine: EngineSpec;
  drivetrain: DrivetrainSpec;
  brakes: BrakeSpec;
  aero: AeroSpec;
};

export type InputFrame = {
  steering: number;
  throttle: number;
  brake: number;
  clutch: number;
  handbrake: number;
  shiftUp: boolean;
  shiftDown: boolean;
  reset: boolean;
  /** When defined, overrides the vehicle spec's autoShift (gameplay transmission mode). */
  autoShift?: boolean;
  timestamp: number;
  sequence: number;
};

export type WheelTelemetry = {
  id: WheelId;
  loadN: number;
  slipRatio: number;
  slipAngleRad: number;
  camberRad: number;
  toeRad: number;
  fx: number;
  fy: number;
  fz: number;
  mz: number;
  suspensionTravel: number;
  angularVelocity: number;
  contactPoint: Vec3Tuple;
  forceWorld: Vec3Tuple;
  tireSurfaceTempC: number;
  tireCarcassTempC: number;
  tireWear: number;
  tireMuScale: number;
  brakeTempC: number;
  brakeFade: number;
  surfaceMaterialId: SurfaceMaterialId;
  contact: boolean;
};

export type TelemetryFrame = {
  time: number;
  speedMps: number;
  yawRate: number;
  sideslipRad: number;
  steeringAngleRad: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  simFrameMs: number;
  wheels: Record<WheelId, WheelTelemetry>;
};

export type WheelSnapshot = {
  id: WheelId;
  pose: Pose;
  steerAngle: number;
  camberAngle: number;
  spinAngle: number;
  angularVelocity: number;
  suspensionTravel: number;
};

export type PhysicsSnapshot = {
  sequence: number;
  simTime: number;
  alpha: number;
  chassis: Pose;
  linearVelocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
  wheels: Record<WheelId, WheelSnapshot>;
  telemetry: TelemetryFrame;
};

export type PhysicsFacade = {
  init(worldSpec: WorldSpec): Promise<void>;
  createVehicle(vehicleSpec: VehicleSpec): Promise<string>;
  submitInput(inputFrame: InputFrame): void;
  step(renderTimeMs: number): void;
  getSnapshot(alpha?: number): PhysicsSnapshot | null;
  reset(seed: number): void;
  applySetup(setup: PhysicsSetup): void;
  querySurface(point: Vec3Tuple): Promise<SurfaceContact>;
  dispose(): void;
};

/**
 * Live-tunable physics overlay applied on top of the validated VehicleSpec. Every field
 * is a multiplier or absolute that defaults to the identity, so an untouched setup leaves
 * the validated dynamics bit-for-bit unchanged. The vehicle reads these when computing
 * brake torque, downforce/drag, grip and ride height — it never rewrites the spec.
 */
export type PhysicsSetup = {
  brakeForceScale: number; // ×maxTorque (1 = stock)
  brakeBias: number; // 0..1 front share (absolute; replaces per-wheel bias split)
  downforceScale: number; // ×liftArea (aero downforce)
  dragScale: number; // ×dragArea
  gripScale: number; // ×tire mu (both axes)
  finalDriveScale: number; // ×final drive ratio
  // Driver aids. 0 disables the aid; higher = stronger intervention. Defaults are ON at a
  // moderate level so the car is friendly out of the box; a hardcore driver dials them to 0.
  tractionControl: number; // 0..1 — clamps drive torque to hold the driven-wheel slip target
  abs: number; // 0..1 — releases brake torque to hold the braked-wheel slip target
  stabilityControl: number; // 0..1 — counters excess yaw (spin) with asymmetric brake/throttle trim
};

export const DEFAULT_PHYSICS_SETUP: PhysicsSetup = {
  brakeForceScale: 1,
  brakeBias: 0.6,
  downforceScale: 1,
  dragScale: 1,
  gripScale: 1,
  finalDriveScale: 1,
  tractionControl: 0.7,
  abs: 0.8,
  stabilityControl: 0.6,
};

export type WorkerRequest =
  | { type: 'init'; world: WorldSpec }
  | { type: 'createVehicle'; vehicle: VehicleSpec }
  | { type: 'input'; input: InputFrame }
  | { type: 'step'; renderTimeMs: number }
  | { type: 'reset'; seed: number }
  | { type: 'setup'; setup: PhysicsSetup }
  | { type: 'querySurface'; id: number; point: Vec3Tuple };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'vehicleCreated'; id: string }
  | { type: 'snapshot'; snapshot: PhysicsSnapshot }
  | { type: 'surface'; id: number; contact: SurfaceContact }
  | { type: 'error'; message: string };
