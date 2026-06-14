import type { QuatTuple } from '../types';
import { Vec3 } from './Vec3';

export class Quat {
  x: number;
  y: number;
  z: number;
  w: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  static identity(): Quat {
    return new Quat();
  }

  static fromTuple(tuple: QuatTuple): Quat {
    return new Quat(tuple[0], tuple[1], tuple[2], tuple[3]);
  }

  static fromAxisAngle(axis: Vec3, angle: number): Quat {
    const half = angle * 0.5;
    const s = Math.sin(half);
    const n = axis.normalized();
    return new Quat(n.x * s, n.y * s, n.z * s, Math.cos(half));
  }

  static slerp(a: Quat, b: Quat, t: number): Quat {
    let bx = b.x;
    let by = b.y;
    let bz = b.z;
    let bw = b.w;
    let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;

    if (cosHalfTheta < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      cosHalfTheta = -cosHalfTheta;
    }

    if (cosHalfTheta >= 1.0) return a.clone();
    if (cosHalfTheta > 0.9995) {
      return new Quat(
        a.x + t * (bx - a.x),
        a.y + t * (by - a.y),
        a.z + t * (bz - a.z),
        a.w + t * (bw - a.w),
      ).normalize();
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return new Quat(
      a.x * ratioA + bx * ratioB,
      a.y * ratioA + by * ratioB,
      a.z * ratioA + bz * ratioB,
      a.w * ratioA + bw * ratioB,
    );
  }

  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  copy(q: Quat): this {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  multiply(q: Quat): this {
    const ax = this.x;
    const ay = this.y;
    const az = this.z;
    const aw = this.w;
    const bx = q.x;
    const by = q.y;
    const bz = q.z;
    const bw = q.w;

    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  multiplied(q: Quat): Quat {
    return this.clone().multiply(q);
  }

  conjugate(): Quat {
    return new Quat(-this.x, -this.y, -this.z, this.w);
  }

  normalize(): this {
    const len = Math.hypot(this.x, this.y, this.z, this.w);
    if (len > 1e-9) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
      this.w /= len;
    }
    return this;
  }

  rotateVector(v: Vec3): Vec3 {
    const qv = new Vec3(this.x, this.y, this.z);
    const uv = qv.cross(v);
    const uuv = qv.cross(uv);
    uv.scale(2 * this.w);
    uuv.scale(2);
    return v.clone().add(uv).add(uuv);
  }

  inverseRotateVector(v: Vec3): Vec3 {
    return this.conjugate().rotateVector(v);
  }

  integrateAngularVelocity(omegaWorld: Vec3, dt: number): this {
    const speed = omegaWorld.length();
    if (speed < 1e-9) return this;
    const delta = Quat.fromAxisAngle(omegaWorld.scaled(1 / speed), speed * dt);
    const next = delta.multiply(this).normalize();
    this.copy(next);
    return this;
  }

  toTuple(): QuatTuple {
    return [this.x, this.y, this.z, this.w];
  }
}
