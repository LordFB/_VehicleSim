import { describe, expect, it } from 'vitest';
import {
  RETTIFILO_ESCAPE_FROM_M,
  RETTIFILO_ESCAPE_TO_M,
  buildStandaloneMonzaWorld,
} from '../../src/standalone/MonzaVehicleSim';
import bridgeSource from '../../src/standalone/MonzaVehicleSim.ts?raw';
import standaloneHtml from '../../monza.html?raw';
import { SurfaceSystem } from '../../src/sim/runtime/SurfaceSystem';

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
    expect(world.barriers.length).toBeGreaterThanOrEqual(8);
    expect(world.barriers.length).toBeLessThanOrEqual(16);
    expect(world.barriers.every((barrier) => barrier.kind === 'armco')).toBe(true);
    const firstLeft = world.barriers.find((barrier) => barrier.id.startsWith('monza-boundary-0-'))!;
    const firstStart = Number(firstLeft.id.split('-').at(-2));
    const firstEnd = Number(firstLeft.id.split('-').at(-1));
    const leftStart = [
      cl.x[firstStart % count] + cl.nx[firstStart % count] * -12,
      cl.z[firstStart % count] + cl.nz[firstStart % count] * -12,
    ];
    const leftEnd = [
      cl.x[firstEnd % count] + cl.nx[firstEnd % count] * -12,
      cl.z[firstEnd % count] + cl.nz[firstEnd % count] * -12,
    ];
    expect(firstLeft.id).toBe(`monza-boundary-0-${firstStart}-${firstEnd}`);
    expect(firstLeft.center[0]).toBeCloseTo((leftStart[0] + leftEnd[0]) / 2);
    expect(firstLeft.center[2]).toBeCloseTo((leftStart[1] + leftEnd[1]) / 2);
    expect(firstLeft.yawRad).toBeCloseTo(
      Math.atan2(leftEnd[0] - leftStart[0], leftEnd[1] - leftStart[1]),
    );
    expect(firstLeft.halfExtents[2]).toBeCloseTo(
      Math.hypot(leftEnd[0] - leftStart[0], leftEnd[1] - leftStart[1]) / 2 + 0.08,
    );
    expect(world.meshSurface?.layers.map((layer) => layer.id)).toContain('rettifilo-straight-escape');
    const escape = world.meshSurface!.layers.find((layer) => layer.id === 'rettifilo-straight-escape')!;
    const probeX = escape.positions.filter((_, i) => i % 3 === 0).reduce((sum, value) => sum + value, 0) / 4;
    const probeZ = escape.positions.filter((_, i) => i % 3 === 2).reduce((sum, value) => sum + value, 0) / 4;
    expect(new SurfaceSystem(world).query([probeX, 20, probeZ]).materialId).toBe('asphalt_new');
    expect(world.barriers.some((barrier) => barrier.id.startsWith('monza-boundary-1-')))
      .toBe(true);
  });

  it('does not bridge a boundary collider across the Rettifilo escape opening', () => {
    const stations = [0, 600, 670, 800, 930, 1000];
    const count = stations.length;
    const cl = {
      count,
      length: 1200,
      x: Float64Array.from({ length: count }, () => 0),
      y: Float32Array.from({ length: count }, () => 0),
      z: Float64Array.from(stations),
      tx: Float32Array.from({ length: count }, () => 0),
      tz: Float32Array.from({ length: count }, () => 1),
      nx: Float32Array.from({ length: count }, () => -1),
      nz: Float32Array.from({ length: count }, () => 0),
      grade: Float32Array.from({ length: count }, () => 0),
      bank: Float32Array.from({ length: count }, () => 0),
      curv: Float32Array.from({ length: count }, () => 0),
      hw: Float32Array.from({ length: count }, () => 5.5),
      s: Float64Array.from(stations),
      crossSectionHeight: (_i: number, _lateral = 0, lift = 0) => lift,
    };
    const world = buildStandaloneMonzaWorld(cl, { edgeBarrier: () => 12 }, 2);
    const boundarySegments = world.barriers
      .filter((barrier) => barrier.id.startsWith('monza-boundary-'))
      .map((barrier) => barrier.id.split('-').slice(-2).map(Number));

    expect(boundarySegments.length).toBeGreaterThan(0);
    for (const [startIndex, endIndex] of boundarySegments) {
      const start = stations[startIndex];
      const end = endIndex === count ? cl.length : stations[endIndex];
      expect(end <= RETTIFILO_ESCAPE_FROM_M - 20 || start >= RETTIFILO_ESCAPE_TO_M + 20)
        .toBe(true);
    }
  });

  it('joins the Rettifilo escape collision surface without a launch-inducing height step', () => {
    const stations = [0, 600, 670, 800, 930, 1000];
    const count = stations.length;
    const cl = {
      count,
      length: 1200,
      x: Float64Array.from({ length: count }, () => 0),
      y: Float32Array.from({ length: count }, () => 0),
      z: Float64Array.from(stations),
      tx: Float32Array.from({ length: count }, () => 0),
      tz: Float32Array.from({ length: count }, () => 1),
      nx: Float32Array.from({ length: count }, () => -1),
      nz: Float32Array.from({ length: count }, () => 0),
      grade: Float32Array.from({ length: count }, () => 0),
      bank: Float32Array.from({ length: count }, () => 0.02),
      curv: Float32Array.from({ length: count }, () => 0),
      hw: Float32Array.from({ length: count }, () => 5.5),
      s: Float64Array.from(stations),
      crossSectionHeight: (_i: number, lateral = 0, lift = 0) =>
        lateral * Math.tan(0.02) + lift,
    };
    const surface = new SurfaceSystem(
      buildStandaloneMonzaWorld(cl, { edgeBarrier: () => 12 }, 2),
    );

    for (const x of [-2, 0, 2]) {
      const beforeJoin = surface.heightAt(x, RETTIFILO_ESCAPE_FROM_M - 0.01);
      const afterJoin = surface.heightAt(x, RETTIFILO_ESCAPE_FROM_M + 0.01);
      expect(Math.abs(afterJoin - beforeJoin)).toBeLessThanOrEqual(0.025);
    }
  });

  it('uses the shared straight escape surface in the visible standalone Rettifilo scene', () => {
    expect(standaloneHtml).toContain('buildRettifiloEscapeSurface(cl)');
    expect(standaloneHtml).toContain("escapeRoad.name = 'RettifiloStraightEscape'");
    expect(standaloneHtml).not.toContain('RettifiloFoamWhite');
    expect(standaloneHtml).not.toContain('RettifiloFoamRed');
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
