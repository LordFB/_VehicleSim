import { describe, expect, it } from 'vitest';
import { buildNordschleifeTrack } from '../../src/level/NordschleifeWorld';
import { SurfaceSystem } from '../../src/sim/runtime/SurfaceSystem';
import { terrainSurfaceHeight } from '../../src/sim/runtime/TerrainSurface';
import type { BarrierSpec } from '../../src/sim/types';

describe('Nordschleife generated track', () => {
  const track = buildNordschleifeTrack();

  it('has real-scale metadata close to the modern 20.832 km Nordschleife', () => {
    expect(track.metadata.realLengthMeters).toBeGreaterThan(20500);
    expect(track.metadata.realLengthMeters).toBeLessThan(21150);
    expect(track.centerline[0].pos[0]).toBeCloseTo(track.centerline.at(-1)!.pos[0], 1);
    expect(track.centerline[0].pos[1]).toBeCloseTo(track.centerline.at(-1)!.pos[1], 1);
  });

  it('returns asphalt on the centerline and grass off the ribbon', () => {
    const surfaces = new SurfaceSystem(track.world);
    const sample = track.centerline[Math.floor(track.centerline.length * 0.35)];
    const onTrack = surfaces.query([sample.pos[0], sample.elevation + 1, sample.pos[1]]);
    const offTrack = surfaces.query([
      sample.pos[0] + sample.left[0] * track.metadata.scaledTrackHalfWidth * 5,
      sample.elevation + 1,
      sample.pos[1] + sample.left[1] * track.metadata.scaledTrackHalfWidth * 5,
    ]);

    expect(onTrack.materialId).toBe('asphalt_new');
    expect(offTrack.materialId).toBe('grass');
  });

  it('returns generated terrain collisions beyond the shoulder instead of flat fallback', () => {
    const surfaces = new SurfaceSystem(track.world);
    const sample = track.centerline[Math.floor(track.centerline.length * 0.18)];
    const terrain = track.world.terrainTrack!;
    const lateral = terrain.halfWidth + terrain.shoulderWidth + 28;
    const x = sample.pos[0] + sample.left[0] * lateral;
    const z = sample.pos[1] + sample.left[1] * lateral;
    const contact = surfaces.query([x, sample.elevation + 10, z]);
    const expectedHeight = terrainSurfaceHeight(
      sample,
      lateral,
      terrain.halfWidth,
      terrain.shoulderWidth,
      x,
      z,
    );

    expect(contact.materialId).toBe('grass');
    expect(contact.point[1]).toBeCloseTo(expectedHeight, 1);
    expect(contact.point[1]).toBeGreaterThan(sample.elevation - 3);
    expect(Math.abs(contact.normal[0]) + Math.abs(contact.normal[2])).toBeGreaterThan(0.005);
  });

  it('produces elevated, non-flat surface normals', () => {
    const surfaces = new SurfaceSystem(track.world);
    const sample = track.centerline.find((p) => Math.abs(p.normal[0]) + Math.abs(p.normal[2]) > 0.04);
    expect(sample).toBeTruthy();
    const contact = surfaces.query([sample!.pos[0], sample!.elevation + 2, sample!.pos[1]]);
    expect(contact.point[1]).toBeCloseTo(sample!.elevation, 1);
    expect(Math.abs(contact.normal[0]) + Math.abs(contact.normal[2])).toBeGreaterThan(0.03);
  });

  it('keeps oriented barriers outside the road ribbon', () => {
    const barriers = track.world.barriers.filter((b) => b.yawRad !== undefined);
    expect(barriers.length).toBeGreaterThan(500);
    for (const barrier of barriers.slice(0, 300)) {
      const source = sourceSegment(barrier.id);
      expect(source).toBeTruthy();
      const a = track.centerline[source!.index];
      const b = track.centerline[source!.index + 1];
      const segmentLength = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]);
      const spans = Math.max(1, Math.ceil(segmentLength / 1.6));
      const t = (source!.span + 0.5) / spans;
      const left = normalizedLeft(a.left[0] + (b.left[0] - a.left[0]) * t, a.left[1] + (b.left[1] - a.left[1]) * t);
      const x = a.pos[0] + (b.pos[0] - a.pos[0]) * t;
      const z = a.pos[1] + (b.pos[1] - a.pos[1]) * t;
      const lateral = Math.abs((barrier.center[0] - x) * left.x + (barrier.center[2] - z) * left.z);
      expect(lateral).toBeGreaterThan(track.metadata.scaledTrackHalfWidth + 0.4);
    }
  });

  it('covers every generated guardrail segment without collision gaps', () => {
    const barriers = track.world.barriers.filter((b) => b.yawRad !== undefined);
    const guardrailOffset = track.metadata.scaledTrackHalfWidth + 1.45;
    const barriersBySegment = new Map<number, BarrierSpec[]>();
    for (const barrier of barriers) {
      const source = sourceSegment(barrier.id);
      if (!source) continue;
      const bucket = barriersBySegment.get(source.index) ?? [];
      bucket.push(barrier);
      barriersBySegment.set(source.index, bucket);
    }

    for (let i = 0; i < track.centerline.length - 1; i += 1) {
      const a = track.centerline[i];
      const b = track.centerline[i + 1];
      if (Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) < 0.01) continue;
      const segmentBarriers = barriersBySegment.get(i) ?? [];

      for (const side of [-1, 1] as const) {
        const left = normalizedLeft((a.left[0] + b.left[0]) * 0.5, (a.left[1] + b.left[1]) * 0.5);
        const x = (a.pos[0] + b.pos[0]) * 0.5 + left.x * guardrailOffset * side;
        const z = (a.pos[1] + b.pos[1]) * 0.5 + left.z * guardrailOffset * side;
        expect(isCoveredByBarrier(segmentBarriers, x, z)).toBe(true);
      }
    }
  });
});

function sourceSegment(id: string): { index: number; span: number } | null {
  const match = /^nord_guard_(\d+)_(left|right)_/.exec(id);
  return match ? { index: Number(match[1]), span: Number(id.split('_')[4]) } : null;
}

function normalizedLeft(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
}

function isCoveredByBarrier(barriers: BarrierSpec[], x: number, z: number): boolean {
  return barriers.some((barrier) => {
    const yaw = barrier.yawRad ?? 0;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dx = x - barrier.center[0];
    const dz = z - barrier.center[2];
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return (
      Math.abs(localX) <= barrier.halfExtents[0] + 0.08 &&
      Math.abs(localZ) <= barrier.halfExtents[2] + 0.08
    );
  });
}
