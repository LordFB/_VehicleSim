import type { Vec3Tuple } from '../types';

export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  static fromTuple(tuple: Vec3Tuple): Vec3 {
    return new Vec3(tuple[0], tuple[1], tuple[2]);
  }

  static zero(): Vec3 {
    return new Vec3();
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(scalar: number): this {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }

  scaled(scalar: number): Vec3 {
    return this.clone().scale(scalar);
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3): Vec3 {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  lengthSq(): number {
    return this.dot(this);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const len = this.length();
    if (len > 1e-9) this.scale(1 / len);
    return this;
  }

  normalized(): Vec3 {
    return this.clone().normalize();
  }

  projectOnPlane(normal: Vec3): Vec3 {
    return this.clone().sub(normal.scaled(this.dot(normal)));
  }

  toTuple(): Vec3Tuple {
    return [this.x, this.y, this.z];
  }
}

export const VEC3_UP = new Vec3(0, 1, 0);
export const VEC3_FORWARD = new Vec3(0, 0, 1);
export const VEC3_RIGHT = new Vec3(1, 0, 0);

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

export function interpolateCurve(points: [number, number][], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (x <= next[0]) {
      const span = next[0] - prev[0];
      const t = span === 0 ? 0 : (x - prev[0]) / span;
      return lerp(prev[1], next[1], t);
    }
  }
  return points[points.length - 1][1];
}
