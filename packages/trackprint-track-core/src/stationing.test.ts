import { describe, expect, it } from 'vitest';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import {
  createStationLookup,
  evaluateStation,
  isFiniteVector,
  nearestStation,
  validateClosedLoop,
} from './index';

describe('stationing', () => {
  it('builds a monotonic arc-length table', () => {
    const lookup = createStationLookup(createDefaultTrackDocument(), 16);
    for (let index = 1; index < lookup.samples.length; index += 1) {
      expect(lookup.samples[index].s).toBeGreaterThanOrEqual(lookup.samples[index - 1].s);
    }
  });

  it('wraps stations on closed tracks', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const wrapped = evaluateStation(document, lookup, lookup.totalLength + 4);
    expect(wrapped.station).toBeGreaterThanOrEqual(0);
    expect(wrapped.station).toBeLessThan(lookup.totalLength);
  });

  it('returns finite station evaluation positions', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    expect(isFiniteVector(evaluateStation(document, lookup, lookup.totalLength / 2).position)).toBe(
      true,
    );
  });

  it('finds nearest stations on a straight fixture', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const nearest = nearestStation(document, lookup, { x: 25, y: 10 });
    expect(nearest.station).toBeGreaterThan(20);
    expect(nearest.station).toBeLessThan(30);
    expect(nearest.side).toBe(1);
  });

  it('validates closed-loop endpoint continuity', () => {
    expect(validateClosedLoop(createDefaultTrackDocument())).toEqual([]);
  });
});
