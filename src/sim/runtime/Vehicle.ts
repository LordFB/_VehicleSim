import type {
  InputFrame,
  PhysicsSetup,
  PhysicsSnapshot,
  SurfaceContact,
  BarrierSpec,
  TelemetryFrame,
  VehicleSpec,
  WheelId,
  WheelSnapshot,
  WheelSpec,
  WheelTelemetry,
} from '../types';
import { DEFAULT_PHYSICS_SETUP } from '../types';
import { Quat } from '../math/Quat';
import { clamp, interpolateCurve, lerp, Vec3, VEC3_FORWARD, VEC3_RIGHT, VEC3_UP } from '../math/Vec3';
import { RigidBody } from './RigidBody';
import type { SurfaceSystem } from './SurfaceSystem';
import { calculateTireForces, createTireState, updateTireThermalState, type TireState } from './TireModel';
import { createDrivetrainState, solveDrivetrain, type DrivetrainState } from './Drivetrain';

type WheelRuntimeState = {
  spec: WheelSpec;
  compression: number;
  previousCompression: number;
  angularVelocity: number;
  spinAngle: number;
  brakeTempC: number;
  tireState: TireState;
  telemetry: WheelTelemetry;
  snapshot: WheelSnapshot;
};

type SuspensionSample = {
  wheel: WheelRuntimeState;
  hardpoint: Vec3;
  contactPoint: Vec3;
  contact: SurfaceContact;
  compression: number;
  compressionVelocity: number;
  springForce: number;
  camber: number;
  toe: number;
  hasGround: boolean;
};

const WHEEL_ORDER: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

// Low-speed static-friction (stiction) parameters. Below STICK_SPEED at the contact
// patch the tire holds rather than relying on the brush model (which yields ~0 force
// at ~0 slip speed). STICK_BLEND scales the holding force toward critical damping.
const STICK_SPEED = 0.6; // m/s
const STICK_BLEND = 0.9;

// Speed-sensitive steering: at/above STEER_SPEED_FULLSCALE the usable steering angle
// is scaled down to STEER_SPEED_FLOOR of max for a planted, precise feel.
const STEER_SPEED_FULLSCALE = 55; // m/s (~200 km/h)
const STEER_SPEED_FLOOR = 0.45;

export class Vehicle {
  readonly id = 'player';
  readonly spec: VehicleSpec;
  readonly chassis: RigidBody;
  // Center of mass expressed in the chassis-origin frame (from the spec). The rigid
  // body integrates about its center of mass, so chassis.position IS the COM in world
  // space; every spec-local attachment point (wheel hardpoints, aero CoP, and the
  // rendered/snapshot body origin) is defined relative to the chassis origin and must
  // be re-expressed relative to the COM before its torque arm is computed — otherwise
  // gravity and the suspension/tire forces pivot about the wrong point and the car
  // tips far too easily.
  private readonly comOffset: Vec3;
  private readonly wheels = new Map<WheelId, WheelRuntimeState>();
  private readonly drivetrainState: DrivetrainState;
  private steeringAngle = 0;
  private lastInput: InputFrame;
  private sequence = 0;
  private telemetry: TelemetryFrame;
  private previousSnapshot: PhysicsSnapshot | null = null;
  private currentSnapshot: PhysicsSnapshot;
  // Live setup overlay (identity by default → stock validated physics).
  private setup: PhysicsSetup = { ...DEFAULT_PHYSICS_SETUP };

  constructor(spec: VehicleSpec, private readonly spawn?: { position: [number, number, number]; yawRad: number }) {
    this.spec = spec;
    this.comOffset = Vec3.fromTuple(spec.chassis.centerOfMass);
    const spawnOrigin = spawn?.position ?? [0, 0.72, 0];
    // Spawn is given as the chassis origin; place the body at the COM (origin + offset,
    // unrotated at spawn since yaw is about the vertical axis only).
    this.chassis = new RigidBody({
      mass: spec.chassis.mass,
      inertia: spec.chassis.inertia,
      position: [spawnOrigin[0] + this.comOffset.x, spawnOrigin[1] + this.comOffset.y, spawnOrigin[2] + this.comOffset.z],
    });
    if (spawn) this.chassis.orientation.copy(Quat.fromAxisAngle(VEC3_UP, spawn.yawRad));
    for (const wheelSpec of spec.wheels) {
      this.wheels.set(wheelSpec.id, this.createWheelState(wheelSpec));
    }
    this.drivetrainState = createDrivetrainState(spec.engine);
    this.lastInput = createNeutralInput();
    this.telemetry = this.createTelemetry(0, 0);
    this.currentSnapshot = this.createSnapshot(0, 0);
  }

  /** Apply a live setup overlay (brakes/aero/grip/ride/final-drive multipliers). */
  applySetup(setup: PhysicsSetup): void {
    this.setup = { ...setup };
  }

  reset(seed: number): void {
    const lateralOffset = ((seed % 97) - 48) * 0.001;
    const base = this.spawn?.position ?? [0, 0.72, 0];
    const yaw = this.spawn?.yawRad ?? 0;
    const right = new Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
    // base is the chassis origin; offset to the COM (yaw-only rotation at reset).
    this.chassis.position.set(
      base[0] + right.x * lateralOffset + this.comOffset.x,
      base[1] + this.comOffset.y,
      base[2] + right.z * lateralOffset + this.comOffset.z,
    );
    this.chassis.orientation.copy(this.spawn ? Quat.fromAxisAngle(VEC3_UP, yaw) : Quat.identity());
    this.chassis.linearVelocity.set(0, 0, 0);
    this.chassis.angularVelocity.set(0, 0, 0);
    this.steeringAngle = 0;
    this.sequence = 0;
    this.lastInput = createNeutralInput();
    this.drivetrainState.gearIndex = 0;
    this.drivetrainState.rpm = this.spec.engine.idleRpm;
    this.drivetrainState.throttleState = 0;
    for (const wheel of this.wheels.values()) {
      wheel.compression = 0;
      wheel.previousCompression = 0;
      wheel.angularVelocity = 0;
      wheel.spinAngle = 0;
      wheel.brakeTempC = this.spec.brakes.ambientTempC;
      wheel.tireState.relaxedSlipAngle = 0;
      wheel.tireState.relaxedSlipRatio = 0;
      wheel.tireState.surfaceTempC = this.spec.brakes.ambientTempC;
      wheel.tireState.carcassTempC = this.spec.brakes.ambientTempC;
      wheel.tireState.wear = 0;
    }
    this.telemetry = this.createTelemetry(0, 0);
    this.previousSnapshot = null;
    this.currentSnapshot = this.createSnapshot(0, 0);
  }

  setInput(input: InputFrame): void {
    this.lastInput = input;
  }

  step(dt: number, gravity: number, surfaceSystem: SurfaceSystem, simTime: number): void {
    const start = performance.now();
    this.chassis.clearAccumulators();
    this.chassis.applyForce(new Vec3(0, -gravity * this.chassis.mass, 0));

    // Speed-sensitive steering: full lock for low-speed maneuvering, progressively
    // less angle as speed rises so the car feels planted and precise instead of twitchy
    // (a defining sim-racing feel trait). Floor keeps enough authority for corrections.
    const speedForSteer = this.chassis.linearVelocity.length();
    const steerScale = Math.max(
      STEER_SPEED_FLOOR,
      1 - (1 - STEER_SPEED_FLOOR) * Math.min(1, speedForSteer / STEER_SPEED_FULLSCALE),
    );
    const targetSteer = clamp(this.lastInput.steering, -1, 1) * this.spec.steering.maxAngleRad * steerScale;
    this.steeringAngle += (targetSteer - this.steeringAngle) * clamp(dt * this.spec.steering.responseRate, 0, 1);

    const samples = this.sampleSuspension(dt, surfaceSystem);
    this.applySuspension(samples);

    const driven = WHEEL_ORDER.map((id) => this.wheels.get(id)).filter((wheel): wheel is WheelRuntimeState => Boolean(wheel?.spec.drive));
    const drivetrainSpec = this.setup.finalDriveScale === 1
      ? this.spec.drivetrain
      : { ...this.spec.drivetrain, finalDrive: this.spec.drivetrain.finalDrive * this.setup.finalDriveScale };
    const drivetrain = solveDrivetrain(
      this.spec.engine,
      drivetrainSpec,
      this.lastInput,
      driven.map((wheel) => wheel.angularVelocity),
      driven.map((wheel) => wheel.spec.id),
      dt,
      this.drivetrainState,
    );
    // A gear change is a discrete event: consume it so it fires exactly once per
    // input frame, not once per physics substep (3x per tick) — otherwise a single
    // paddle tap would jump several gears.
    if (this.lastInput.shiftUp || this.lastInput.shiftDown) {
      this.lastInput = { ...this.lastInput, shiftUp: false, shiftDown: false };
    }

    this.applyTires(samples, drivetrain.driveTorqueByWheel, dt);
    this.applyAero();
    this.chassis.integrate(dt);
    this.solvePrimitiveBarrierFloor(surfaceSystem);

    for (const wheel of this.wheels.values()) {
      wheel.spinAngle += wheel.angularVelocity * dt;
    }
    this.telemetry = this.createTelemetry(simTime, performance.now() - start, drivetrain.rpm, drivetrain.gear);
    this.sequence += 1;
    this.previousSnapshot = this.currentSnapshot;
    this.currentSnapshot = this.createSnapshot(simTime, 0);
  }

  getSnapshot(alpha: number): PhysicsSnapshot {
    if (!this.previousSnapshot) return { ...this.currentSnapshot, alpha };
    return interpolateSnapshots(this.previousSnapshot, this.currentSnapshot, clamp(alpha, 0, 1));
  }

  solveBarriers(barriers: BarrierSpec[]): void {
    // The car's true footprint is an oriented box; project its rotated half-extents
    // onto the world X/Z axes so contact against the (axis-aligned) walls is tight at
    // any heading instead of using a fixed axis-aligned approximation that lets the
    // car visually clip in or stop short when turned.
    const half = Vec3.fromTuple([
      this.spec.chassis.dimensions[0] * 0.5,
      this.spec.chassis.dimensions[1] * 0.5,
      this.spec.chassis.dimensions[2] * 0.5,
    ]);
    const axX = this.chassis.worldVector(VEC3_RIGHT);
    const axZ = this.chassis.worldVector(VEC3_FORWARD);
    // Extent of the OBB projected on world X and world Z.
    const halfX = Math.abs(axX.x) * half.x + Math.abs(axZ.x) * half.z;
    const halfZ = Math.abs(axX.z) * half.x + Math.abs(axZ.z) * half.z;

    for (const barrier of barriers) {
      if (barrier.yawRad !== undefined) {
        this.solveOrientedBarrier(barrier, half, axX, axZ);
        continue;
      }
      const dx = this.chassis.position.x - barrier.center[0];
      const dz = this.chassis.position.z - barrier.center[2];
      const penetrationX = barrier.halfExtents[0] + halfX - Math.abs(dx);
      const penetrationZ = barrier.halfExtents[2] + halfZ - Math.abs(dz);
      const verticalOverlap =
        Math.abs(this.chassis.position.y - barrier.center[1]) <
        barrier.halfExtents[1] + half.y;
      if (penetrationX <= 0 || penetrationZ <= 0 || !verticalOverlap) continue;

      // Resolve along the axis of least penetration (the contact normal).
      if (penetrationX < penetrationZ) {
        const normalX = Math.sign(dx) || 1;
        this.chassis.position.x += normalX * penetrationX;
        const vn = this.chassis.linearVelocity.x;
        if (vn * normalX < 0) {
          // Remove the into-wall component and add a small bounce; keep the tangential
          // (sliding-along-the-wall) velocity so it doesn't feel sticky.
          this.chassis.linearVelocity.x = -vn * 0.18;
        }
      } else {
        const normalZ = Math.sign(dz) || 1;
        this.chassis.position.z += normalZ * penetrationZ;
        const vn = this.chassis.linearVelocity.z;
        if (vn * normalZ < 0) {
          this.chassis.linearVelocity.z = -vn * 0.18;
        }
      }
      // Scrub a little angular momentum on impact (scaled by how hard the hit was).
      this.chassis.angularVelocity.scale(0.86);
    }
  }

  private solveOrientedBarrier(barrier: BarrierSpec, chassisHalf: Vec3, chassisAxisX: Vec3, chassisAxisZ: Vec3): void {
    const yaw = barrier.yawRad ?? 0;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dx = this.chassis.position.x - barrier.center[0];
    const dz = this.chassis.position.z - barrier.center[2];
    // Barrier local axes: +Z follows the guardrail, +X is lateral thickness.
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const carHalfX =
      Math.abs(chassisAxisX.x * cos - chassisAxisX.z * sin) * chassisHalf.x +
      Math.abs(chassisAxisZ.x * cos - chassisAxisZ.z * sin) * chassisHalf.z;
    const carHalfZ =
      Math.abs(chassisAxisX.x * sin + chassisAxisX.z * cos) * chassisHalf.x +
      Math.abs(chassisAxisZ.x * sin + chassisAxisZ.z * cos) * chassisHalf.z;
    const penetrationX = barrier.halfExtents[0] + carHalfX - Math.abs(localX);
    const penetrationZ = barrier.halfExtents[2] + carHalfZ - Math.abs(localZ);
    const verticalOverlap =
      Math.abs(this.chassis.position.y - barrier.center[1]) <
      barrier.halfExtents[1] + chassisHalf.y;
    if (penetrationX <= 0 || penetrationZ <= 0 || !verticalOverlap) return;

    const resolveLocalX = penetrationX < penetrationZ;
    const normalLocalX = resolveLocalX ? Math.sign(localX) || 1 : 0;
    const normalLocalZ = resolveLocalX ? 0 : Math.sign(localZ) || 1;
    const normalWorldX = normalLocalX * cos + normalLocalZ * sin;
    const normalWorldZ = -normalLocalX * sin + normalLocalZ * cos;
    const penetration = resolveLocalX ? penetrationX : penetrationZ;
    this.chassis.position.x += normalWorldX * penetration;
    this.chassis.position.z += normalWorldZ * penetration;
    const vn = this.chassis.linearVelocity.x * normalWorldX + this.chassis.linearVelocity.z * normalWorldZ;
    if (vn < 0) {
      this.chassis.linearVelocity.x -= normalWorldX * vn * 1.18;
      this.chassis.linearVelocity.z -= normalWorldZ * vn * 1.18;
    }
    this.chassis.angularVelocity.scale(0.86);
  }

  /** World position of a point given in the chassis-origin frame (COM-corrected). */
  private chassisLocalToWorld(local: Vec3): Vec3 {
    return this.chassis.worldPoint(local.clone().sub(this.comOffset));
  }

  private createWheelState(spec: WheelSpec): WheelRuntimeState {
    const emptyTelemetry: WheelTelemetry = {
      id: spec.id,
      loadN: 0,
      slipRatio: 0,
      slipAngleRad: 0,
      camberRad: 0,
      toeRad: 0,
      fx: 0,
      fy: 0,
      fz: 0,
      mz: 0,
      suspensionTravel: 0,
      angularVelocity: 0,
      contactPoint: [0, 0, 0],
      forceWorld: [0, 0, 0],
      tireSurfaceTempC: spec.tire.optimalTempC - 55,
      tireCarcassTempC: spec.tire.optimalTempC - 55,
      tireWear: 0,
      tireMuScale: spec.tire.coldMuScale,
      brakeTempC: 24,
      brakeFade: 1,
      surfaceMaterialId: 'asphalt_new',
      contact: false,
    };
    return {
      spec,
      compression: 0,
      previousCompression: 0,
      angularVelocity: 0,
      spinAngle: 0,
      brakeTempC: 24,
      tireState: createTireState(),
      telemetry: emptyTelemetry,
      snapshot: {
        id: spec.id,
        pose: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
        steerAngle: 0,
        camberAngle: 0,
        spinAngle: 0,
        angularVelocity: 0,
        suspensionTravel: 0,
      },
    };
  }

  private sampleSuspension(dt: number, surfaceSystem: SurfaceSystem): SuspensionSample[] {
    const samples: SuspensionSample[] = [];
    for (const id of WHEEL_ORDER) {
      const wheel = this.wheels.get(id);
      if (!wheel) continue;
      const hardpoint = this.chassisLocalToWorld(Vec3.fromTuple(wheel.spec.localPosition));
      const surface = surfaceSystem.query(hardpoint);
      const groundY = surface.point[1];
      const distanceToGround = hardpoint.y - groundY - wheel.spec.tire.radius;
      const compression = clamp(wheel.spec.suspension.restLength - distanceToGround, 0, wheel.spec.suspension.restLength + wheel.spec.suspension.droopLimit);
      const hasGround = distanceToGround <= wheel.spec.suspension.restLength + wheel.spec.suspension.droopLimit && hardpoint.y > groundY;
      const firstCompressionSample = wheel.previousCompression === 0 && wheel.compression === 0;
      const compressionVelocity = firstCompressionSample ? 0 : (compression - wheel.compression) / Math.max(dt, 1e-6);
      const damperRate = compressionVelocity >= 0 ? wheel.spec.suspension.damperBump : wheel.spec.suspension.damperRebound;
      const bumpStop = Math.max(0, compression - (wheel.spec.suspension.restLength - wheel.spec.suspension.bumpStopLength));
      const springForce = hasGround
        ? Math.max(
            0,
            compression * wheel.spec.suspension.springRate * wheel.spec.suspension.motionRatio +
              compressionVelocity * damperRate +
              bumpStop * wheel.spec.suspension.bumpStopRate,
          )
        : 0;
      const contactPoint = new Vec3(hardpoint.x, groundY, hardpoint.z);
      const camber = interpolateCurve(wheel.spec.suspension.camberCurve, compression);
      const toe = interpolateCurve(wheel.spec.suspension.toeCurve, compression);

      samples.push({ wheel, hardpoint, contactPoint, contact: surface, compression, compressionVelocity, springForce, camber, toe, hasGround });
      wheel.previousCompression = wheel.compression;
      wheel.compression = compression;
    }
    return samples;
  }

  private applySuspension(samples: SuspensionSample[]): void {
    const byId = new Map(samples.map((sample) => [sample.wheel.spec.id, sample]));
    for (const sample of samples) {
      let forceN = sample.springForce;
      const isLeft = sample.wheel.spec.id.endsWith('Left');
      const oppositeId = sample.wheel.spec.id.replace(isLeft ? 'Left' : 'Right', isLeft ? 'Right' : 'Left') as WheelId;
      const opposite = byId.get(oppositeId);
      if (opposite) {
        const rollDelta = sample.compression - opposite.compression;
        forceN += (isLeft ? -rollDelta : rollDelta) * sample.wheel.spec.suspension.antiRollRate;
      }
      if (sample.hasGround && forceN > 0) {
        this.chassis.applyForce(VEC3_UP.scaled(forceN), sample.hardpoint);
      }
      sample.wheel.telemetry.fz = Math.max(0, forceN);
      sample.wheel.telemetry.loadN = Math.max(0, forceN);
      sample.wheel.telemetry.suspensionTravel = sample.compression;
      sample.wheel.telemetry.camberRad = sample.camber;
      sample.wheel.telemetry.toeRad = sample.toe;
      sample.wheel.telemetry.contact = sample.hasGround;
      sample.wheel.telemetry.surfaceMaterialId = sample.contact.materialId;
      sample.wheel.telemetry.contactPoint = sample.contactPoint.toTuple();
    }
  }

  private applyTires(samples: SuspensionSample[], driveTorqueByWheel: Partial<Record<WheelId, number>>, dt: number): void {
    const chassisForward = this.chassis.worldVector(VEC3_FORWARD).projectOnPlane(VEC3_UP).normalize();
    const chassisRight = this.chassis.worldVector(VEC3_RIGHT).projectOnPlane(VEC3_UP).normalize();

    for (const sample of samples) {
      const wheel = sample.wheel;
      if (!sample.hasGround || sample.springForce <= 0) {
        wheel.telemetry.fx = 0;
        wheel.telemetry.fy = 0;
        wheel.telemetry.mz = 0;
        wheel.telemetry.forceWorld = [0, 0, 0];
        wheel.telemetry.brakeTempC = wheel.brakeTempC;
        wheel.telemetry.brakeFade = calculateBrakeFade(wheel.brakeTempC, this.spec.brakes.fadeStartC, this.spec.brakes.fadeEndC);
        wheel.telemetry.tireSurfaceTempC = wheel.tireState.surfaceTempC;
        wheel.telemetry.tireCarcassTempC = wheel.tireState.carcassTempC;
        wheel.telemetry.tireWear = wheel.tireState.wear;
        wheel.telemetry.tireMuScale = calculateColdAirMuPreview(wheel.spec.tire.coldMuScale, wheel.tireState.wear);
        wheel.angularVelocity += (driveTorqueByWheel[wheel.spec.id] ?? 0) / wheel.spec.inertia * dt;
        coolBrake(wheel, this.spec.brakes, 0, dt);
        continue;
      }

      const steer = wheel.spec.steer ? this.steeringAngle : 0;
      const toeSteer = steer + sample.toe;
      const cos = Math.cos(toeSteer);
      const sin = Math.sin(toeSteer);
      const wheelForward = chassisForward.scaled(cos).add(chassisRight.scaled(sin)).normalize();
      const wheelRight = chassisRight.scaled(cos).sub(chassisForward.scaled(sin)).normalize();
      const contactVelocity = this.chassis.velocityAtPoint(sample.contactPoint);
      const vLong = contactVelocity.dot(wheelForward);
      const vLat = contactVelocity.dot(wheelRight);
      const slipRatio = clamp((wheel.angularVelocity * wheel.spec.tire.radius - vLong) / Math.max(Math.abs(vLong), 3), -2, 2);
      const slipAngle = Math.atan2(vLat, Math.max(Math.abs(vLong), 1));
      // Setup grip overlay: scale the contact friction both axes (1 = stock). A fresh
      // contact object is used so the surface system's data is never mutated.
      const gripSurface = this.setup.gripScale === 1
        ? sample.contact
        : { ...sample.contact, muLongitudinal: sample.contact.muLongitudinal * this.setup.gripScale, muLateral: sample.contact.muLateral * this.setup.gripScale };
      const forces = calculateTireForces({
        tire: wheel.spec.tire,
        normalLoad: wheel.telemetry.loadN,
        slipRatio,
        slipAngleRad: slipAngle,
        camberRad: sample.camber,
        speedMps: vLong,
        surface: gripSurface,
        dt,
        state: wheel.tireState,
      });
      // Static friction / stiction at low speed: a brush tire model produces no force
      // at zero slip speed, so without this a parked car has no resistance and any
      // micro-velocity (settling, idle engine-braking) runs away. Below a small speed,
      // and when the driver isn't commanding drive, add a critically-damped force that
      // arrests the residual contact velocity, clamped to the available grip.
      const driveTorque = driveTorqueByWheel[wheel.spec.id] ?? 0;
      const speedAtPatch = Math.hypot(vLong, vLat);
      // "Commanding drive" = the driver wants to move (throttle, or a real drive torque
      // on a driven wheel). When commanding drive we must NOT hold longitudinally or the
      // car can never launch from rest.
      const commandingDrive = this.lastInput.throttle > 0.04 || driveTorque > 120;
      if (speedAtPatch < STICK_SPEED && this.lastInput.handbrake < 0.5) {
        const muHold = sample.contact.muLongitudinal * forces.muScale;
        const gripN = muHold * wheel.telemetry.loadN;
        const massShare = this.chassis.mass / samples.length;
        const hold = 1 - speedAtPatch / STICK_SPEED; // fade out toward the threshold
        // Lateral hold always (stops sideways creep without fighting throttle).
        const stickLat = clamp(-vLat * massShare / dt, -gripN, gripN) * STICK_BLEND;
        let stickLong = 0;
        if (!commandingDrive) {
          // Longitudinal hold only when coasting/stopped — this is what pins a parked car.
          stickLong = clamp(-vLong * massShare / dt, -gripN, gripN) * STICK_BLEND;
          // Bleed the wheel toward rolling-without-slip so it stops spinning up backwards.
          const targetOmega = vLong / wheel.spec.tire.radius;
          wheel.angularVelocity += (targetOmega - wheel.angularVelocity) * Math.min(1, 12 * dt);
        }
        const stickForce = wheelForward.scaled(stickLong * hold).add(wheelRight.scaled(stickLat * hold));
        this.chassis.applyForce(stickForce, sample.contactPoint);
      }

      const tireForce = wheelForward.scaled(forces.fx).add(wheelRight.scaled(forces.fy));
      this.chassis.applyForce(tireForce, sample.contactPoint);

      // Setup overlay: scale total brake force and split it by the configured bias
      // (front share). Defaults reproduce the stock per-wheel bias exactly.
      const isRear = wheel.spec.id.startsWith('rear');
      const biasShare = isRear ? 1 - this.setup.brakeBias : this.setup.brakeBias;
      const requestedBrakeTorque =
        this.lastInput.brake * this.spec.brakes.maxTorque * this.setup.brakeForceScale * biasShare +
        (isRear ? this.lastInput.handbrake * this.spec.brakes.handbrakeTorque : 0);
      const brakeFade = calculateBrakeFade(wheel.brakeTempC, this.spec.brakes.fadeStartC, this.spec.brakes.fadeEndC);
      const brakeTorque = requestedBrakeTorque * brakeFade;
      const brakeDirection = Math.sign(wheel.angularVelocity) || Math.sign(vLong) || 1;
      const rollingTorque = sample.contact.muLongitudinal * wheel.spec.tire.rollingResistanceScale * wheel.telemetry.loadN * wheel.spec.tire.radius;
      // Engine braking and rolling resistance oppose motion; they must not push a
      // stationary wheel backwards past zero. Cap the decelerating torque so it can
      // only remove existing rotation within this step, never reverse it.
      const passiveTorque = brakeTorque * brakeDirection + rollingTorque * Math.sign(wheel.angularVelocity || vLong || 1);
      const driveAngularAccel = (driveTorque - forces.fx * wheel.spec.tire.radius) / wheel.spec.inertia;
      let nextOmega = wheel.angularVelocity + driveAngularAccel * dt;
      const passiveAccel = passiveTorque / wheel.spec.inertia;
      const passiveDelta = passiveAccel * dt;
      // Only let passive torque reduce |nextOmega| toward zero, not flip its sign.
      if (Math.abs(passiveDelta) >= Math.abs(nextOmega) && Math.sign(passiveDelta) === Math.sign(nextOmega || passiveDelta)) {
        nextOmega = 0;
      } else {
        nextOmega -= passiveDelta;
      }
      wheel.angularVelocity = nextOmega;
      if (Math.abs(wheel.angularVelocity) < 0.05 && (this.lastInput.brake > 0.7 || (speedAtPatch < STICK_SPEED && !commandingDrive))) {
        wheel.angularVelocity = 0;
      }

      const slipPowerW =
        Math.abs(forces.fx * (wheel.angularVelocity * wheel.spec.tire.radius - vLong)) +
        Math.abs(forces.fy * vLat);
      updateTireThermalState(wheel.spec.tire, wheel.tireState, sample.contact, slipPowerW, vLong, wheel.telemetry.loadN, dt);
      heatAndCoolBrake(wheel, this.spec.brakes, brakeTorque, vLong, wheel.spec.tire.radius, dt);

      wheel.telemetry.fx = forces.fx;
      wheel.telemetry.fy = forces.fy;
      wheel.telemetry.mz = forces.mz;
      wheel.telemetry.slipRatio = forces.slipRatio;
      wheel.telemetry.slipAngleRad = forces.slipAngleRad;
      wheel.telemetry.angularVelocity = wheel.angularVelocity;
      wheel.telemetry.forceWorld = tireForce.toTuple();
      wheel.telemetry.tireSurfaceTempC = wheel.tireState.surfaceTempC;
      wheel.telemetry.tireCarcassTempC = wheel.tireState.carcassTempC;
      wheel.telemetry.tireWear = wheel.tireState.wear;
      wheel.telemetry.tireMuScale = forces.muScale;
      wheel.telemetry.brakeTempC = wheel.brakeTempC;
      wheel.telemetry.brakeFade = brakeFade;
    }
  }

  private applyAero(): void {
    const speedSq = this.chassis.linearVelocity.lengthSq();
    if (speedSq < 0.01) return;
    const drag = this.chassis.linearVelocity.normalized().scale(-0.5 * this.spec.aero.airDensity * this.spec.aero.dragArea * this.setup.dragScale * speedSq);
    const downforce = VEC3_UP.scaled(-0.5 * this.spec.aero.airDensity * this.spec.aero.liftArea * this.setup.downforceScale * speedSq);
    const cp = this.chassisLocalToWorld(Vec3.fromTuple(this.spec.aero.centerOfPressure));
    this.chassis.applyForce(drag, cp);
    this.chassis.applyForce(downforce, cp);
  }

  private solvePrimitiveBarrierFloor(surfaceSystem: SurfaceSystem): void {
    const ground = surfaceSystem.heightAt(this.chassis.position.x, this.chassis.position.z);
    const minY = ground + this.spec.chassis.dimensions[1] * 0.28;
    if (this.chassis.position.y < minY) {
      this.chassis.position.y = minY;
      if (this.chassis.linearVelocity.y < 0) this.chassis.linearVelocity.y *= -0.15;
      this.chassis.angularVelocity.scale(0.96);
    }
  }

  private createTelemetry(time: number, simFrameMs: number, rpm = this.drivetrainState.rpm, gear = this.drivetrainState.gearIndex + 1): TelemetryFrame {
    const forward = this.chassis.worldVector(VEC3_FORWARD).projectOnPlane(VEC3_UP).normalize();
    const right = this.chassis.worldVector(VEC3_RIGHT).projectOnPlane(VEC3_UP).normalize();
    const speed = this.chassis.linearVelocity.length();
    const longSpeed = this.chassis.linearVelocity.dot(forward);
    const latSpeed = this.chassis.linearVelocity.dot(right);
    const wheels = Object.fromEntries(WHEEL_ORDER.map((id) => [id, { ...this.wheels.get(id)!.telemetry }])) as TelemetryFrame['wheels'];
    return {
      time,
      speedMps: speed,
      yawRate: this.chassis.angularVelocity.y,
      sideslipRad: Math.atan2(latSpeed, Math.max(Math.abs(longSpeed), 0.1)),
      steeringAngleRad: this.steeringAngle,
      rpm,
      gear,
      throttle: this.lastInput.throttle,
      brake: this.lastInput.brake,
      simFrameMs,
      wheels,
    };
  }

  private createSnapshot(simTime: number, alpha: number): PhysicsSnapshot {
    const wheels = {} as Record<WheelId, WheelSnapshot>;
    for (const id of WHEEL_ORDER) {
      const wheel = this.wheels.get(id)!;
      const local = Vec3.fromTuple(wheel.spec.localPosition);
      const center = this.chassisLocalToWorld(local).sub(VEC3_UP.scaled(wheel.spec.suspension.restLength - wheel.compression));
      const steerQuat = Quat.fromAxisAngle(VEC3_UP, wheel.spec.steer ? this.steeringAngle : 0);
      const spinQuat = Quat.fromAxisAngle(VEC3_RIGHT, wheel.spinAngle);
      const camberQuat = Quat.fromAxisAngle(VEC3_FORWARD, wheel.telemetry.camberRad);
      const orientation = this.chassis.orientation.clone().multiply(steerQuat).multiply(camberQuat).multiply(spinQuat);
      wheel.snapshot = {
        id,
        pose: { position: center.toTuple(), orientation: orientation.toTuple() },
        steerAngle: wheel.spec.steer ? this.steeringAngle : 0,
        camberAngle: wheel.telemetry.camberRad,
        spinAngle: wheel.spinAngle,
        angularVelocity: wheel.angularVelocity,
        suspensionTravel: wheel.compression,
      };
      wheels[id] = wheel.snapshot;
    }
    // Report the chassis *origin* pose (not the COM) so the rendered body, which is
    // modeled about the origin, sits where designed even though the body integrates
    // about the COM.
    const originWorld = this.chassis.position.clone().sub(this.chassis.worldVector(this.comOffset));
    return {
      sequence: this.sequence,
      simTime,
      alpha,
      chassis: { position: originWorld.toTuple(), orientation: this.chassis.orientation.toTuple() },
      linearVelocity: this.chassis.linearVelocity.toTuple(),
      angularVelocity: this.chassis.angularVelocity.toTuple(),
      wheels,
      telemetry: this.telemetry,
    };
  }
}

function calculateBrakeFade(tempC: number, fadeStartC: number, fadeEndC: number): number {
  if (fadeEndC <= fadeStartC) return 1;
  const t = clamp((tempC - fadeStartC) / (fadeEndC - fadeStartC), 0, 1);
  return clamp(1 - t * 0.55, 0.45, 1);
}

function heatAndCoolBrake(
  wheel: WheelRuntimeState,
  brake: VehicleSpec['brakes'],
  brakeTorque: number,
  speedMps: number,
  tireRadius: number,
  dt: number,
): void {
  const rotorSpeedProxy = Math.max(Math.abs(wheel.angularVelocity), Math.abs(speedMps) / Math.max(tireRadius, 0.05) * 0.5);
  const brakePowerW = Math.abs(brakeTorque * rotorSpeedProxy);
  wheel.brakeTempC += brakePowerW * dt / Math.max(1, brake.heatCapacity);
  coolBrake(wheel, brake, speedMps, dt);
}

function coolBrake(wheel: WheelRuntimeState, brake: VehicleSpec['brakes'], speedMps: number, dt: number): void {
  const cooling = brake.coolingRate + Math.abs(speedMps) * 0.014;
  wheel.brakeTempC += (brake.ambientTempC - wheel.brakeTempC) * clamp(cooling * dt, 0, 1);
  if (wheel.brakeTempC < brake.ambientTempC) wheel.brakeTempC = brake.ambientTempC;
}

function calculateColdAirMuPreview(coldMuScale: number, wear: number): number {
  return clamp(coldMuScale * (1 - wear * 0.36), 0.48, 1);
}

function createNeutralInput(): InputFrame {
  return {
    steering: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    handbrake: 0,
    shiftUp: false,
    shiftDown: false,
    reset: false,
    timestamp: 0,
    sequence: 0,
  };
}

function interpolateSnapshots(a: PhysicsSnapshot, b: PhysicsSnapshot, alpha: number): PhysicsSnapshot {
  const wheels = {} as Record<WheelId, WheelSnapshot>;
  for (const id of WHEEL_ORDER) {
    const aw = a.wheels[id];
    const bw = b.wheels[id];
    wheels[id] = {
      ...bw,
      pose: {
        position: [
          lerp(aw.pose.position[0], bw.pose.position[0], alpha),
          lerp(aw.pose.position[1], bw.pose.position[1], alpha),
          lerp(aw.pose.position[2], bw.pose.position[2], alpha),
        ],
        orientation: Quat.slerp(Quat.fromTuple(aw.pose.orientation), Quat.fromTuple(bw.pose.orientation), alpha).toTuple(),
      },
      steerAngle: lerp(aw.steerAngle, bw.steerAngle, alpha),
      camberAngle: lerp(aw.camberAngle, bw.camberAngle, alpha),
      spinAngle: lerp(aw.spinAngle, bw.spinAngle, alpha),
      angularVelocity: lerp(aw.angularVelocity, bw.angularVelocity, alpha),
      suspensionTravel: lerp(aw.suspensionTravel, bw.suspensionTravel, alpha),
    };
  }
  return {
    ...b,
    alpha,
    chassis: {
      position: [
        lerp(a.chassis.position[0], b.chassis.position[0], alpha),
        lerp(a.chassis.position[1], b.chassis.position[1], alpha),
        lerp(a.chassis.position[2], b.chassis.position[2], alpha),
      ],
      orientation: Quat.slerp(Quat.fromTuple(a.chassis.orientation), Quat.fromTuple(b.chassis.orientation), alpha).toTuple(),
    },
    linearVelocity: [
      lerp(a.linearVelocity[0], b.linearVelocity[0], alpha),
      lerp(a.linearVelocity[1], b.linearVelocity[1], alpha),
      lerp(a.linearVelocity[2], b.linearVelocity[2], alpha),
    ],
    angularVelocity: [
      lerp(a.angularVelocity[0], b.angularVelocity[0], alpha),
      lerp(a.angularVelocity[1], b.angularVelocity[1], alpha),
      lerp(a.angularVelocity[2], b.angularVelocity[2], alpha),
    ],
    wheels,
  };
}
