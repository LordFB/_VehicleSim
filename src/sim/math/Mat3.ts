import type { Vec3Tuple } from '../types';
import { Vec3 } from './Vec3';

export class DiagonalMat3 {
  x: number;
  y: number;
  z: number;

  constructor(diagonal: Vec3Tuple) {
    this.x = diagonal[0];
    this.y = diagonal[1];
    this.z = diagonal[2];
  }

  multiplyVector(v: Vec3): Vec3 {
    return new Vec3(v.x * this.x, v.y * this.y, v.z * this.z);
  }
}
