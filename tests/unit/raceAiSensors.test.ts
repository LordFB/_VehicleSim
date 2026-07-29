import { describe, expect, it } from 'vitest';
import { computeBrakingTarget } from '../../src/race/FullRaceRuntime';
import type { RaceCourseSpec } from '../../src/race/types';

describe('race AI track sensors', () => {
  it('detects a slow chicane far enough ahead to brake from Monza speed', () => {
    const course: RaceCourseSpec = {
      lengthM: 1_000,
      samples: Array.from({ length: 100 }, (_, index) => ({
        stationM: index * 10,
        position: [0, 0, index * 10] as [number, number, number],
        tangent: [0, 1] as [number, number],
        targetSpeedMps: index >= 30 && index <= 35 ? 25 : 90,
        brakeTargetSpeedMps: index >= 30 && index <= 35 ? 25 : 90,
        curvature: index >= 30 && index <= 35 ? 0.04 : 0,
        cornerName: index >= 30 && index <= 35 ? 'Rettifilo' : null,
        halfWidthM: 7,
        racingLineOffsetM: 0,
      })),
    };

    const sensed = computeBrakingTarget(course, 0);
    expect(sensed.targetSpeedMps).toBeLessThan(80);
    expect(sensed.cornerName).toBe('Rettifilo');
    expect(sensed.distanceM).toBeGreaterThanOrEqual(280);
    expect(sensed.distanceM).toBeLessThanOrEqual(320);
  });
});
