import { describe, expect, it } from 'vitest';
import { buildStandaloneMonzaWorld } from '../../src/standalone/MonzaVehicleSim';
import bridgeSource from '../../src/standalone/MonzaVehicleSim.ts?raw';

describe('standalone Monza Vehicle Sim world', () => {
  it('derives terrain, spawn, width, and collidable edges from the render centerline', () => {
    const count = 8;
    const cl = {
      count,
      length: 5793,
      x: Float64Array.from([0, 0, 20, 40, 40, 40, 20, 0]),
      y: Float32Array.from([1, 2, 3, 4, 5, 4, 3, 2]),
      z: Float64Array.from([0, 20, 40, 40, 20, 0, -20, -20]),
      tx: Float32Array.from([0, .7, 1, .7, 0, -.7, -1, -.7]),
      tz: Float32Array.from([1, .7, 0, -.7, -1, -.7, 0, .7]),
      nx: Float32Array.from([-1, -.7, 0, .7, 1, .7, 0, -.7]),
      nz: Float32Array.from([0, .7, 1, .7, 0, -.7, -1, -.7]),
      grade: Float32Array.from([.01, .01, 0, -.01, -.01, -.01, 0, .01]),
      bank: Float32Array.from([0, .01, .02, .01, 0, -.01, -.02, -.01]),
      curv: Float32Array.from([0, .01, .02, .01, 0, -.01, -.02, -.01]),
      hw: Float32Array.from({ length: count }, () => 5.5),
      s: Float64Array.from([0, 724, 1448, 2172, 2896, 3620, 4344, 5068]),
      crossSectionHeight: (i: number, lateral = 0, lift = 0) =>
        [1, 2, 3, 4, 5, 4, 3, 2][i] + lateral * Math.tan([0, .01, .02, .01, 0, -.01, -.02, -.01][i]) + lift,
    };
    // TrackSurface returns an unsigned distance; the bridge owns side polarity.
    const surf = {
      edgeBarrier: () => 12,
    };

    const world = buildStandaloneMonzaWorld(cl, surf, 2);

    expect(world.terrainTrack?.samples).toHaveLength(count);
    expect(world.terrainTrack?.samples[4].elevation).toBe(5);
    expect(world.terrainTrack?.samples[2].camber).toBeCloseTo(.02);
    expect(world.terrainTrack?.halfWidth).toBeCloseTo(5.5);
    expect(world.spawn?.position).toEqual([0, 1.72, 0]);
    expect(world.spawn?.yawRad).toBeCloseTo(0);
    expect(world.barriers).toHaveLength(8);
    expect(world.barriers.every((barrier) => barrier.kind === 'armco')).toBe(true);
    for (let i = 0; i < world.barriers.length; i += 2) {
      const left = world.barriers[i].center;
      const right = world.barriers[i + 1].center;
      const sample = (i / 2) * 2;
      const leftOffset =
        (left[0] - cl.x[sample]) * cl.nx[sample] +
        (left[2] - cl.z[sample]) * cl.nz[sample];
      const rightOffset =
        (right[0] - cl.x[sample]) * cl.nx[sample] +
        (right[2] - cl.z[sample]) * cl.nz[sample];
      expect(leftOffset).toBeLessThan(0);
      expect(rightOffset).toBeGreaterThan(0);
      expect(left).not.toEqual(right);
    }
  });

  it('carries audio, skid marks, and tire smoke into the standalone bridge', () => {
    expect(bridgeSource).toContain('new EngineAudio()');
    expect(bridgeSource).toContain('new SkidMarks()');
    expect(bridgeSource).toContain('new TireSmoke()');
    expect(bridgeSource).toContain('this.audio.update(snapshot.telemetry');
    expect(bridgeSource).toContain('this.skidMarks.update(snapshot)');
    expect(bridgeSource).toContain('this.tireSmoke.update(snapshot');
    expect(bridgeSource).toContain('this.skidMarks.clear()');
  });

  it('live-applies the shared car setup to physics, input, and transmission', () => {
    expect(bridgeSource).toContain('applySetup(setup: CarSetup)');
    expect(bridgeSource).toContain('this.physics.applySetup(setup.physics)');
    expect(bridgeSource).toContain('this.input.applyInputSetup(setup.input)');
    expect(bridgeSource).toContain('this.input.setAutoShift(setup.autoShift)');
  });
});
