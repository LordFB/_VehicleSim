import { describe, expect, it } from 'vitest';
import { createStraightTrackDocument } from '@trackprint/test-fixtures';
import {
  applyWidthFalloff,
  createStationLookup,
  evaluateTrackWidth,
  validateTrackWidth,
  type TrackDocument,
} from './index';

describe('track width', () => {
  it('evaluates constant left and right widths', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    expect(evaluateTrackWidth(document, lookup, 12)).toMatchObject({
      left: 5,
      right: 5,
      total: 10,
    });
  });

  it('rejects negative width values', () => {
    const document: TrackDocument = {
      ...createStraightTrackDocument(),
      width: {
        left: { constant: -1 },
        right: { constant: 5 },
      },
    };
    expect(validateTrackWidth(document).some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('interpolates keyed width placeholders', () => {
    const document: TrackDocument = {
      ...createStraightTrackDocument(),
      width: {
        left: {
          constant: 4,
          keys: [
            { station: 0, value: 4 },
            { station: 50, value: 8 },
          ],
        },
        right: { constant: 5 },
      },
    };
    const lookup = createStationLookup(document, 8);
    expect(evaluateTrackWidth(document, lookup, 25).left).toBeCloseTo(6, 1);
  });

  it('applies a width falloff that peaks at center and returns to the prior width', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const edited: TrackDocument = {
      ...document,
      width: {
        left: applyWidthFalloff(document.width!.left, lookup, 25, 10, 15),
        right: document.width!.right,
      },
    };

    // Center hits the typed value exactly; the untouched right side is unchanged.
    expect(evaluateTrackWidth(edited, lookup, 25).left).toBeCloseTo(10, 5);
    expect(evaluateTrackWidth(edited, lookup, 25).right).toBeCloseTo(5, 5);
    // Beyond the radius the width returns to the prior constant.
    expect(evaluateTrackWidth(edited, lookup, 5).left).toBeCloseTo(5, 1);
    expect(evaluateTrackWidth(edited, lookup, 45).left).toBeCloseTo(5, 1);
    // Inside the radius it tapers between prior and target.
    const halfway = evaluateTrackWidth(edited, lookup, 32).left;
    expect(halfway).toBeGreaterThan(5);
    expect(halfway).toBeLessThan(10);
  });

  it('preserves width keys outside the falloff window', () => {
    const document: TrackDocument = {
      ...createStraightTrackDocument(),
      width: {
        left: { constant: 5, keys: [{ station: 2, value: 7 }] },
        right: { constant: 5 },
      },
    };
    const lookup = createStationLookup(document, 8);
    const editedLeft = applyWidthFalloff(document.width!.left, lookup, 40, 9, 6);

    // The far key at station 2 is well outside [34, 46] and survives untouched.
    expect(editedLeft.keys?.some((key) => key.station === 2 && key.value === 7)).toBe(true);
  });
});
