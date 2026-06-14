import { describe, expect, it } from 'vitest';
import { Quat } from '../../src/sim/math/Quat';
import { Vec3 } from '../../src/sim/math/Vec3';

describe('simulation math', () => {
  it('computes vector cross products in the configured Y-up, +Z-forward basis', () => {
    const right = new Vec3(1, 0, 0);
    const up = new Vec3(0, 1, 0);
    expect(right.cross(up).toTuple()).toEqual([0, 0, 1]);
  });

  it('rotates vectors with quaternions', () => {
    const yaw90 = Quat.fromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
    const forward = yaw90.rotateVector(new Vec3(0, 0, 1));
    expect(forward.x).toBeCloseTo(1, 5);
    expect(forward.z).toBeCloseTo(0, 5);
  });

  it('integrates angular velocity without losing normalization', () => {
    const orientation = Quat.identity();
    orientation.integrateAngularVelocity(new Vec3(0, 1, 0), 0.5);
    const len = Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w);
    expect(len).toBeCloseTo(1, 6);
  });
});
