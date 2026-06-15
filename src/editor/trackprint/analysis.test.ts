import { describe, expect, it } from 'vitest';
import { createStationLookup } from '@trackprint/track-core';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import { analyzeTrack, initialTelemetry, updateTelemetry } from './analysis';

describe('analysis metrics', () => {
  it('reports near-zero curvature on a straight', () => {
    const document = createStraightTrackDocument();
    const analysis = analyzeTrack(document, createStationLookup(document, 32), 16);

    expect(Math.max(...analysis.samples.map((sample) => sample.curvature))).toBeLessThan(0.001);
  });

  it('reports finite overlay values on an oval', () => {
    const document = createDefaultTrackDocument();
    const analysis = analyzeTrack(document, createStationLookup(document, 32), 32);

    expect(analysis.samples).toHaveLength(32);
    expect(analysis.samples.every((sample) => Number.isFinite(sample.severity))).toBe(true);
    expect(analysis.peakStations.length).toBeGreaterThan(0);
  });

  it('calculates slope and banking fixtures', () => {
    const document = {
      ...createStraightTrackDocument(),
      elevation: { keys: [{ station: 0, value: 0 }, { station: 50, value: 5 }] },
      banking: { keys: [{ station: 0, value: 0 }, { station: 50, value: 0.2 }] },
    };
    const analysis = analyzeTrack(document, createStationLookup(document, 32), 8);

    expect(analysis.samples.some((sample) => sample.gradePercent > 0)).toBe(true);
    expect(analysis.samples.some((sample) => sample.bankingRate > 0)).toBe(true);
  });

  it('keeps telemetry deltas stable', () => {
    const first = updateTelemetry(initialTelemetry(), { time: 10, station: 20, speed: 40, offTrack: false }, 'sector-a');
    const second = updateTelemetry(first, { time: 12, station: 40, speed: 42, offTrack: false }, 'sector-a');

    expect(second.bestSectorTimes['sector-a']).toBe(10);
    expect(second.currentSectorDeltas['sector-a']).toBe(2);
  });
});
