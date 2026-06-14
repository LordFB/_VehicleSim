import type { Pose, Vec3Tuple } from '../types';
import { DiagonalMat3 } from '../math/Mat3';
import { Quat } from '../math/Quat';
import { Vec3 } from '../math/Vec3';

export type RigidBodyOptions = {
  mass: number;
  inertia: Vec3Tuple;
  position?: Vec3Tuple;
  orientation?: [number, number, number, number];
};

export class RigidBody {
  readonly mass: number;
  readonly invMass: number;
  readonly inertia: DiagonalMat3;
  readonly invInertia: DiagonalMat3;
  position: Vec3;
  orientation: Quat;
  linearVelocity = new Vec3();
  angularVelocity = new Vec3();
  force = new Vec3();
  torque = new Vec3();

  constructor(options: RigidBodyOptions) {
    this.mass = options.mass;
    this.invMass = options.mass > 0 ? 1 / options.mass : 0;
    this.inertia = new DiagonalMat3(options.inertia);
    this.invInertia = new DiagonalMat3([
      options.inertia[0] > 0 ? 1 / options.inertia[0] : 0,
      options.inertia[1] > 0 ? 1 / options.inertia[1] : 0,
      options.inertia[2] > 0 ? 1 / options.inertia[2] : 0,
    ]);
    this.position = Vec3.fromTuple(options.position ?? [0, 0, 0]);
    this.orientation = options.orientation ? Quat.fromTuple(options.orientation) : Quat.identity();
  }

  clearAccumulators(): void {
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  applyForce(force: Vec3, worldPoint?: Vec3): void {
    this.force.add(force);
    if (worldPoint) {
      const r = worldPoint.clone().sub(this.position);
      this.torque.add(r.cross(force));
    }
  }

  velocityAtPoint(worldPoint: Vec3): Vec3 {
    const r = worldPoint.clone().sub(this.position);
    return this.linearVelocity.clone().add(this.angularVelocity.cross(r));
  }

  worldVector(local: Vec3): Vec3 {
    return this.orientation.rotateVector(local);
  }

  worldPoint(local: Vec3): Vec3 {
    return this.position.clone().add(this.worldVector(local));
  }

  localVector(world: Vec3): Vec3 {
    return this.orientation.inverseRotateVector(world);
  }

  integrate(dt: number): void {
    this.linearVelocity.add(this.force.scaled(this.invMass * dt));
    this.position.add(this.linearVelocity.scaled(dt));

    const localTorque = this.localVector(this.torque);
    const localAngularAccel = this.invInertia.multiplyVector(localTorque);
    const worldAngularAccel = this.worldVector(localAngularAccel);
    this.angularVelocity.add(worldAngularAccel.scaled(dt));
    this.orientation.integrateAngularVelocity(this.angularVelocity, dt);
  }

  pose(): Pose {
    return {
      position: this.position.toTuple(),
      orientation: this.orientation.toTuple(),
    };
  }
}
