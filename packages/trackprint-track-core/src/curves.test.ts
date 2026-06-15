import { describe, expect, it } from 'vitest';
import {
  applyStationValueFalloff,
  createStationLookup,
  evaluateStationValueCurve,
  stationValueDerivative,
  validateStationValueCurve,
} from './index';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';

describe('station value curves', () => {
  it('interpolates keyed station values', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const value = evaluateStationValueCurve(
      { keys: [{ station: 0, value: 0 }, { station: 50, value: 10 }] },
      lookup,
      25,
    );

    expect(value).toBeCloseTo(5);
  });

  it('returns a finite slope for a linear fixture', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const slope = stationValueDerivative(
      { keys: [{ station: 0, value: 0 }, { station: 50, value: 5 }] },
      lookup,
      25,
    );

    expect(slope).toBeCloseTo(0.1);
  });

  it('wraps closed-track values across the loop boundary', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 8);
    const value = evaluateStationValueCurve(
      { keys: [{ station: 10, value: 10 }, { station: lookup.totalLength - 10, value: 40 }] },
      lookup,
      0,
    );

    expect(value).toBeCloseTo(25);
  });

  it('applies a station-value falloff that peaks at center and returns to prior', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const edited = applyStationValueFalloff(undefined, lookup, 25, 8, 15);

    expect(evaluateStationValueCurve(edited, lookup, 25)).toBeCloseTo(8, 5);
    expect(evaluateStationValueCurve(edited, lookup, 5)).toBeCloseTo(0, 1);
    expect(evaluateStationValueCurve(edited, lookup, 45)).toBeCloseTo(0, 1);
    const partial = evaluateStationValueCurve(edited, lookup, 33);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(8);
  });

  it('warns when banking exceeds the configured limit', () => {
    const issues = validateStationValueCurve('Banking', {
      keys: [{ station: 0, value: Math.PI }],
    }, undefined, { maxAbsValue: Math.PI / 3, unitLabel: ' rad' });

    expect(issues.some((issue) => issue.severity === 'warning')).toBe(true);
  });
});
