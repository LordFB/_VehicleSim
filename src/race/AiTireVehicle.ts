import { Quat } from '../sim/math/Quat';
import { clamp, Vec3, VEC3_FORWARD, VEC3_RIGHT, VEC3_UP } from '../sim/math/Vec3';
import { RigidBody } from '../sim/runtime/RigidBody';
import type { SurfaceSystem } from '../sim/runtime/SurfaceSystem';
import type {
  BarrierSpec,
  InputFrame,
  PhysicsSnapshot,
  SurfaceContact,
  VehicleSpec,
  VehicleDamageEffects,
  WheelId,
  WheelSnapshot,
  WheelTelemetry,
} from '../sim/types';
import { DEFAULT_VEHICLE_DAMAGE_EFFECTS } from '../sim/types';

const RACE_CHASSIS_CLEARANCE_M = 0.72;

/**
 * Deterministic planar tire model for race AI. It preserves tire slip, axle
 * loads, friction circles, aero and braking without solving four suspension
 * contacts and the complete drivetrain for every AI car.
 */
export class AiTireVehicle {
  readonly chassis: RigidBody;
  readonly spec: VehicleSpec;
  private input: InputFrame = {
    steering: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0,
    shiftUp: false, shiftDown: false, reset: false, autoShift: true,
    timestamp: 0, sequence: 0,
  };
  private steeringAngle = 0;
  private yaw = 0;
  private yawRate = 0;
  private speedLong = 0;
  private speedLat = 0;
  private spinAngles: Record<WheelId, number> = {
    frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0,
  };
  private sequence = 0;
  private snapshot: PhysicsSnapshot;
  private surfaceContact: SurfaceContact | null = null;
  private damageEffects: VehicleDamageEffects = {
    ...DEFAULT_VEHICLE_DAMAGE_EFFECTS,
    wheelGripScale: { ...DEFAULT_VEHICLE_DAMAGE_EFFECTS.wheelGripScale },
    punctured: { ...DEFAULT_VEHICLE_DAMAGE_EFFECTS.punctured },
  };

  constructor(spec: VehicleSpec, spawn: { position: [number, number, number]; yawRad: number }) {
    this.spec = spec;
    this.yaw = spawn.yawRad;
    this.chassis = new RigidBody({
      mass: spec.chassis.mass,
      inertia: spec.chassis.inertia,
      position: spawn.position,
      orientation: Quat.fromAxisAngle(VEC3_UP, spawn.yawRad).toTuple(),
    });
    this.snapshot = this.createSnapshot(0);
  }

  setInput(input: InputFrame): void {
    this.input = { ...input };
  }

  applyDamageEffects(effects: VehicleDamageEffects): void {
    this.damageEffects = {
      ...effects,
      wheelGripScale: { ...effects.wheelGripScale },
      punctured: { ...effects.punctured },
    };
  }

  step(dt: number, gravity: number, surfaceSystem: SurfaceSystem, simTime: number): void {
    // Surface meshes are deterministic but comparatively expensive to query.
    // A car cannot cross a meaningful material/elevation boundary in four
    // 120 Hz steps, so cache the centre contact between 30 Hz sensor samples.
    if (!this.surfaceContact || this.sequence % 4 === 0) {
      this.surfaceContact = surfaceSystem.query(this.chassis.position);
    }
    const contact = this.surfaceContact;
    const mass = this.spec.chassis.mass;
    const speed = Math.abs(this.speedLong);
    const steerLimit = this.spec.steering.maxAngleRad
      * clamp(1.15 - speed / 115, 0.42, 1)
      * this.damageEffects.steeringScale;
    const desiredSteer = clamp(
      this.input.steering + this.damageEffects.steeringBias,
      -1,
      1,
    ) * steerLimit;
    const steerStep = this.spec.steering.responseRate * dt;
    this.steeringAngle += clamp(desiredSteer - this.steeringAngle, -steerStep, steerStep);

    const frontZ = averageWheelZ(this.spec, true);
    const rearZ = Math.abs(averageWheelZ(this.spec, false));
    const wheelbase = Math.max(1, frontZ + rearZ);
    const denominator = Math.max(4, Math.abs(this.speedLong));
    const frontSlip = Math.atan2(this.speedLat + this.yawRate * frontZ, denominator) - this.steeringAngle;
    const rearSlip = Math.atan2(this.speedLat - this.yawRate * rearZ, denominator);

    const aeroLoad = 0.5 * this.spec.aero.airDensity * this.spec.aero.liftArea
      * this.damageEffects.downforceScale * speed * speed;
    const totalLoad = mass * Math.abs(gravity) + aeroLoad;
    const frontShare = rearZ / wheelbase;
    const frontLoad = totalLoad * frontShare;
    const rearLoad = totalLoad - frontLoad;
    const lateralForceBuild = clamp((speed - 0.5) / 7, 0, 1);
    const frontGripScale = (
      this.damageEffects.wheelGripScale.frontLeft + this.damageEffects.wheelGripScale.frontRight
    ) * 0.5;
    const rearGripScale = (
      this.damageEffects.wheelGripScale.rearLeft + this.damageEffects.wheelGripScale.rearRight
    ) * 0.5;
    let frontFy = clamp(
      -axleCorneringStiffness(this.spec, true) * frontSlip,
      -contact.muLateral * frontGripScale * frontLoad,
      contact.muLateral * frontGripScale * frontLoad,
    ) * lateralForceBuild;
    let rearFy = clamp(
      -axleCorneringStiffness(this.spec, false) * rearSlip,
      -contact.muLateral * rearGripScale * rearLoad,
      contact.muLateral * rearGripScale * rearLoad,
    ) * lateralForceBuild;

    const driveForce = this.input.throttle * this.damageEffects.powerScale
      * (8_200 + Math.max(0, 8_000 - speed * 120));
    const brakeDirection = this.speedLong >= 0 ? -1 : 1;
    const brakeForce = this.input.brake * contact.muLongitudinal * totalLoad * brakeDirection;
    const dragForce = -Math.sign(this.speedLong) * (
      0.5 * this.spec.aero.airDensity * this.spec.aero.dragArea * this.damageEffects.dragScale
      * this.speedLong * this.speedLong
      + totalLoad * averageRollingResistance(this.spec)
    );
    let rearFx = driveForce + brakeForce * 0.42 + dragForce;
    let frontFx = brakeForce * 0.58;
    ({ fx: frontFx, fy: frontFy } = frictionCircle(
      frontFx, frontFy, contact.muLongitudinal * frontGripScale * frontLoad,
    ));
    ({ fx: rearFx, fy: rearFy } = frictionCircle(
      rearFx, rearFy, contact.muLongitudinal * rearGripScale * rearLoad,
    ));

    const cosSteer = Math.cos(this.steeringAngle);
    const sinSteer = Math.sin(this.steeringAngle);
    const steeredFrontFx = frontFx * cosSteer - frontFy * sinSteer;
    const steeredFrontFy = frontFx * sinSteer + frontFy * cosSteer;
    const forceLong = steeredFrontFx + rearFx;
    const forceLat = steeredFrontFy + rearFy;
    const yawMoment = steeredFrontFy * frontZ - rearFy * rearZ;

    this.speedLong += (forceLong / mass + this.speedLat * this.yawRate) * dt;
    this.speedLat += (forceLat / mass - this.speedLong * this.yawRate) * dt;
    this.yawRate += (yawMoment / this.spec.chassis.inertia[1]) * dt;
    const desiredYawRate = this.speedLong / wheelbase * Math.tan(this.steeringAngle);
    const stabilityResponse = 1.8 + clamp(speed / 18, 0, 1) * 2.2;
    this.yawRate += (desiredYawRate - this.yawRate) * stabilityResponse * dt;
    const physicalYawLimit = Math.abs(this.speedLong / wheelbase)
      * Math.tan(this.spec.steering.maxAngleRad) * 1.35 + 0.08;
    this.yawRate = clamp(this.yawRate, -physicalYawLimit, physicalYawLimit);
    this.speedLat *= Math.exp(-(0.7 + speed * 0.025) * dt);
    const lateralSpeedLimit = 0.32 * Math.abs(this.speedLong) + 0.5;
    this.speedLat = clamp(this.speedLat, -lateralSpeedLimit, lateralSpeedLimit);
    if (Math.abs(this.speedLong) < 0.04 && this.input.throttle === 0) this.speedLong = 0;

    this.yaw += this.yawRate * dt;
    this.chassis.orientation.copy(Quat.fromAxisAngle(VEC3_UP, this.yaw));
    const forward = this.chassis.worldVector(VEC3_FORWARD);
    const right = this.chassis.worldVector(VEC3_RIGHT);
    this.chassis.linearVelocity.copy(forward.scaled(this.speedLong)).add(right.scaled(this.speedLat));
    this.chassis.angularVelocity.set(0, this.yawRate, 0);
    this.chassis.position.add(this.chassis.linearVelocity.scaled(dt));
    // Race spawns describe the visual/physics chassis origin, not a ground
    // contact point. Keep the same clearance used by the Monza grid builder
    // while following track elevation.
    this.chassis.position.y = contact.point[1] + RACE_CHASSIS_CLEARANCE_M;

    for (const wheel of this.spec.wheels) {
      this.spinAngles[wheel.id] += (this.speedLong / wheel.tire.radius) * dt;
    }
    this.sequence += 1;
    this.snapshot = this.createSnapshot(simTime, contact, frontSlip, rearSlip, frontFx, rearFx, frontFy, rearFy);
  }

  solveBarriers(barriers: BarrierSpec[]): void {
    const halfWidth = this.spec.chassis.dimensions[0] * 0.5;
    const halfLength = this.spec.chassis.dimensions[2] * 0.5;
    const axisX = this.chassis.worldVector(VEC3_RIGHT);
    const axisZ = this.chassis.worldVector(VEC3_FORWARD);
    for (const barrier of barriers) {
      const yaw = barrier.yawRad ?? 0;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = this.chassis.position.x - barrier.center[0];
      const dz = this.chassis.position.z - barrier.center[2];
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      const carHalfX = Math.abs(axisX.x * cos - axisX.z * sin) * halfWidth
        + Math.abs(axisZ.x * cos - axisZ.z * sin) * halfLength;
      const carHalfZ = Math.abs(axisX.x * sin + axisX.z * cos) * halfWidth
        + Math.abs(axisZ.x * sin + axisZ.z * cos) * halfLength;
      const penetrationX = barrier.halfExtents[0] + carHalfX - Math.abs(localX);
      const penetrationZ = barrier.halfExtents[2] + carHalfZ - Math.abs(localZ);
      if (penetrationX <= 0 || penetrationZ <= 0) continue;

      const resolveX = penetrationX < penetrationZ;
      const localNx = resolveX ? Math.sign(localX) || 1 : 0;
      const localNz = resolveX ? 0 : Math.sign(localZ) || 1;
      const penetration = resolveX ? penetrationX : penetrationZ;
      const nx = localNx * cos + localNz * sin;
      const nz = -localNx * sin + localNz * cos;
      this.chassis.position.x += nx * penetration;
      this.chassis.position.z += nz * penetration;
      const normalSpeed = this.chassis.linearVelocity.x * nx + this.chassis.linearVelocity.z * nz;
      if (normalSpeed < 0) {
        this.chassis.linearVelocity.x -= nx * normalSpeed * 1.08;
        this.chassis.linearVelocity.z -= nz * normalSpeed * 1.08;
        const localVelocity = this.chassis.localVector(this.chassis.linearVelocity);
        this.speedLat = localVelocity.x;
        this.speedLong = localVelocity.z;
      }
      this.yawRate *= 0.82;
    }
  }

  getSnapshot(alpha: number): PhysicsSnapshot {
    return { ...this.snapshot, alpha: clamp(alpha, 0, 1) };
  }

  private createSnapshot(
    simTime: number,
    surface?: SurfaceContact,
    frontSlip = 0,
    rearSlip = 0,
    frontFx = 0,
    rearFx = 0,
    frontFy = 0,
    rearFy = 0,
  ): PhysicsSnapshot {
    const wheelSnapshots = {} as Record<WheelId, WheelSnapshot>;
    const wheelTelemetry = {} as Record<WheelId, WheelTelemetry>;
    const totalLoad = this.spec.chassis.mass * 9.81;
    for (const wheel of this.spec.wheels) {
      const isFront = wheel.steer;
      const load = totalLoad * (isFront ? 0.52 : 0.48) * 0.5;
      const slipAngle = isFront ? frontSlip : rearSlip;
      const fx = (isFront ? frontFx : rearFx) * 0.5;
      const fy = (isFront ? frontFy : rearFy) * 0.5;
      const steer = isFront ? this.steeringAngle : 0;
      const wheelOrientation = this.chassis.orientation
        .multiplied(Quat.fromAxisAngle(VEC3_UP, steer))
        .multiply(Quat.fromAxisAngle(VEC3_RIGHT, this.spinAngles[wheel.id]));
      const wheelPosition = this.chassis
        .worldPoint(Vec3.fromTuple(wheel.localPosition))
        .sub(VEC3_UP.scaled(wheel.suspension.restLength));
      const contactPoint = wheelPosition.clone().add(new Vec3(0, -wheel.tire.radius, 0));
      const angularVelocity = this.speedLong / wheel.tire.radius;
      const slipRatio = clamp(
        (wheel.drive ? this.input.throttle * 0.06 : 0) - this.input.brake * 0.1,
        -0.12,
        0.08,
      );
      wheelSnapshots[wheel.id] = {
        id: wheel.id,
        pose: { position: wheelPosition.toTuple(), orientation: wheelOrientation.toTuple() },
        steerAngle: steer,
        camberAngle: 0,
        spinAngle: this.spinAngles[wheel.id],
        angularVelocity,
        suspensionTravel: wheel.suspension.restLength * 0.54,
      };
      wheelTelemetry[wheel.id] = {
        id: wheel.id,
        loadN: load,
        slipRatio,
        slipAngleRad: slipAngle,
        camberRad: 0,
        toeRad: 0,
        fx,
        fy,
        fz: load,
        mz: -fy * wheel.tire.pneumaticTrail,
        suspensionTravel: wheel.suspension.restLength * 0.54,
        angularVelocity,
        contactPoint: contactPoint.toTuple(),
        forceWorld: this.chassis.worldVector(new Vec3(fy, load, fx)).toTuple(),
        tireSurfaceTempC: 78,
        tireCarcassTempC: 76,
        tireWear: 0,
        tireMuScale: 1,
        brakeTempC: 90 + this.input.brake * 180,
        brakeFade: 0,
        surfaceMaterialId: surface?.materialId ?? 'asphalt_new',
        contact: true,
      };
    }
    const speed = Math.hypot(this.speedLong, this.speedLat);
    const gear = clamp(Math.floor(speed / 13) + 1, 1, this.spec.drivetrain.gearRatios.length);
    return {
      sequence: this.sequence,
      simTime,
      alpha: 0,
      chassis: this.chassis.pose(),
      linearVelocity: this.chassis.linearVelocity.toTuple(),
      angularVelocity: this.chassis.angularVelocity.toTuple(),
      wheels: wheelSnapshots,
      telemetry: {
        time: simTime,
        speedMps: speed,
        yawRate: this.yawRate,
        sideslipRad: Math.atan2(this.speedLat, Math.max(1, Math.abs(this.speedLong))),
        steeringAngleRad: this.steeringAngle,
        rpm: clamp(3_500 + (speed % 13) * 390, this.spec.engine.idleRpm, this.spec.engine.redlineRpm),
        gear,
        throttle: this.input.throttle,
        brake: this.input.brake,
        simFrameMs: 0,
        wheels: wheelTelemetry,
      },
    };
  }
}

function averageWheelZ(spec: VehicleSpec, front: boolean): number {
  const wheels = spec.wheels.filter((wheel) => wheel.steer === front);
  return wheels.reduce((sum, wheel) => sum + wheel.localPosition[2], 0) / Math.max(1, wheels.length);
}

function axleCorneringStiffness(spec: VehicleSpec, front: boolean): number {
  return spec.wheels
    .filter((wheel) => wheel.steer === front)
    .reduce((sum, wheel) => sum + wheel.tire.corneringStiffness, 0);
}

function averageRollingResistance(spec: VehicleSpec): number {
  return spec.wheels.reduce((sum, wheel) => sum + wheel.tire.rollingResistanceScale, 0) / spec.wheels.length;
}

function frictionCircle(fx: number, fy: number, limit: number): { fx: number; fy: number } {
  const magnitude = Math.hypot(fx, fy);
  if (magnitude <= limit || magnitude <= 1e-9) return { fx, fy };
  const scale = limit / magnitude;
  return { fx: fx * scale, fy: fy * scale };
}
