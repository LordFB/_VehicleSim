import { describe, expect, it } from 'vitest';
import { resolveWallSegments, validateWalls } from './walls';
import type { Vector2 } from './vector';
import type { WallInterval } from './trackDocument';

const wall = (points: Vector2[], over: Partial<WallInterval> = {}): WallInterval => ({
  id: 'w1',
  points,
  cornerMode: 'cornered',
  cornerRadius: 4,
  height: 1,
  segmentLength: 2,
  style: 'armco',
  materialId: 'armco',
  ...over,
});

describe('resolveWallSegments', () => {
  it('lays boxes along a straight drawn segment', () => {
    // A 40 m line along +x at z=5.
    const segments = resolveWallSegments(wall([{ x: 0, y: 5 }, { x: 40, y: 5 }]));
    // ~40 m / 2 m steps ≈ 20 boxes.
    expect(segments.length).toBeGreaterThanOrEqual(19);
    expect(segments.length).toBeLessThanOrEqual(21);
    for (const segment of segments) {
      expect(segment.position.y).toBeCloseTo(5, 6); // stays on the drawn line
      expect(Math.abs(segment.yawRad)).toBeCloseTo(Math.PI / 2, 6); // along +x
      expect(segment.height).toBe(1);
      expect(segment.halfLength).toBeCloseTo(1, 6);
    }
    // The run advances along +x within the drawn span.
    expect(segments[0].position.x).toBeGreaterThanOrEqual(0);
    expect(segments[segments.length - 1].position.x).toBeLessThanOrEqual(40);
  });

  it('follows a multi-point corner, changing direction at the bend', () => {
    // An L: east then north.
    const segments = resolveWallSegments(wall([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]));
    const yaws = new Set(segments.map((segment) => Math.round((segment.yawRad * 180) / Math.PI)));
    // Cornered: two distinct headings (east leg ~90°, north leg ~0°).
    expect(yaws.size).toBeGreaterThanOrEqual(2);
  });

  it('rounds an interior corner when smooth, inserting intermediate headings', () => {
    const cornered = resolveWallSegments(
      wall([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], { cornerMode: 'cornered' }),
    );
    const smooth = resolveWallSegments(
      wall([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }], { cornerMode: 'smooth', cornerRadius: 6 }),
    );
    const headingCount = (segs: typeof smooth) => new Set(segs.map((s) => Math.round((s.yawRad * 180) / Math.PI))).size;
    // A fillet introduces a spread of intermediate headings the sharp corner lacks.
    expect(headingCount(smooth)).toBeGreaterThan(headingCount(cornered));
  });

  it('returns no segments for a degenerate (single-point) wall', () => {
    expect(resolveWallSegments(wall([{ x: 5, y: 5 }]))).toHaveLength(0);
    expect(resolveWallSegments(wall([{ x: 5, y: 5 }, { x: 5, y: 5 }]))).toHaveLength(0);
  });
});

describe('validateWalls', () => {
  it('passes a well-formed wall', () => {
    expect(validateWalls([wall([{ x: 0, y: 0 }, { x: 10, y: 0 }])])).toHaveLength(0);
  });

  it('flags non-physical height and segment length as errors', () => {
    const issues = validateWalls([wall([{ x: 0, y: 0 }, { x: 10, y: 0 }], { height: 0, segmentLength: 0 })]);
    expect(issues.filter((issue) => issue.severity === 'error').length).toBeGreaterThanOrEqual(2);
  });

  it('warns when a wall has fewer than two distinct points', () => {
    const issues = validateWalls([wall([{ x: 1, y: 1 }])]);
    expect(issues.some((issue) => /at least two points/.test(issue.message))).toBe(true);
  });
});
