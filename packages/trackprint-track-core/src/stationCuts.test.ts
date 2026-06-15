import { describe, expect, it } from 'vitest';
import { createStationLookup, type StationCut } from './index';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { collectStationCuts, processStationCuts } from './stationCuts';

describe('station cuts', () => {
  it('preserves forced cuts exactly', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const forced: StationCut = {
      station: 123.456,
      sourceType: 'sector-boundary',
      sourceId: 'forced',
      locked: true,
      optional: false,
    };
    const processed = processStationCuts([forced], lookup).cuts;
    expect(processed[0].station).toBeCloseTo(123.456);
    expect(processed[0].sourceId).toBe('forced');
  });

  it('sorts and deduplicates station cuts', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const processed = processStationCuts(
      [
        { station: 20, sourceType: 'adaptive-curvature', sourceId: 'b', locked: false, optional: true },
        { station: 10, sourceType: 'segment-boundary', sourceId: 'a', locked: true, optional: false },
        { station: 10.00001, sourceType: 'adaptive-curvature', sourceId: 'c', locked: false, optional: true },
      ],
      lookup,
      0.001,
    ).cuts;

    expect(processed.map((cut) => cut.station)).toEqual([10, 20]);
    expect(processed[0].sources.map((source) => source.sourceId)).toContain('c');
  });

  it('wraps closed-track cuts into the track length', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const processed = processStationCuts(
      [{ station: lookup.totalLength + 5, sourceType: 'sector-boundary', sourceId: 'wrap', locked: true, optional: false }],
      lookup,
    ).cuts;
    expect(processed[0].station).toBeCloseTo(5);
  });

  it('collects segment, sector, width, and adaptive cuts', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const cuts = collectStationCuts(document, lookup, 8);
    expect(cuts.some((cut) => cut.sourceType === 'segment-boundary')).toBe(true);
    expect(cuts.some((cut) => cut.sourceType === 'sector-boundary')).toBe(true);
    expect(cuts.some((cut) => cut.sourceType === 'adaptive-curvature')).toBe(true);
  });

  it('collects curb, runoff, and profile repeat cuts', () => {
    const document = {
      ...createDefaultTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 12,
          endStation: 24,
          width: 1,
          height: 0.1,
          profile: 'sawtooth' as const,
          materialId: 'curb',
        },
      ],
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 12,
          endStation: 24,
          width: 3,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 16);
    const cuts = collectStationCuts(document, lookup, 8);

    expect(cuts.some((cut) => cut.sourceType === 'curb-interval')).toBe(true);
    expect(cuts.some((cut) => cut.sourceType === 'runoff-interval')).toBe(true);
    expect(cuts.some((cut) => cut.sourceType === 'profile-repeat')).toBe(true);
  });

  it('warns on minimum spacing violations', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const result = processStationCuts(
      [
        { station: 10, sourceType: 'sector-boundary', sourceId: 'a', locked: true, optional: false },
        { station: 10.01, sourceType: 'sector-boundary', sourceId: 'b', locked: true, optional: false },
      ],
      lookup,
      0.0001,
      0.05,
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
