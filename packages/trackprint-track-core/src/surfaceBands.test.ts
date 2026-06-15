import { describe, expect, it } from 'vitest';
import { createStationLookup, findActiveCurb, validateCurbs, validateRunoffs } from './index';
import { createStraightTrackDocument } from '@trackprint/test-fixtures';

describe('surface bands', () => {
  it('finds active curbs by side and station', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'left-curb',
          side: 'left' as const,
          startStation: 5,
          endStation: 20,
          width: 1,
          height: 0.1,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);

    expect(findActiveCurb(document, lookup, 10, 'left')?.id).toBe('left-curb');
    expect(findActiveCurb(document, lookup, 10, 'right')).toBeNull();
  });

  it('rejects negative curb and runoff dimensions', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'bad-curb',
          side: 'left' as const,
          startStation: 0,
          endStation: 10,
          width: -1,
          height: -0.1,
          taperLength: -1,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
      runoffs: [
        {
          id: 'bad-runoff',
          side: 'left' as const,
          startStation: 0,
          endStation: 10,
          width: -2,
          taperLength: -1,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);

    expect(validateCurbs(document, lookup).filter((issue) => issue.severity === 'error')).toHaveLength(3);
    expect(validateRunoffs(document, lookup).filter((issue) => issue.severity === 'error')).toHaveLength(2);
  });

  it('detects overlapping intervals on the same side', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'a',
          side: 'left' as const,
          startStation: 0,
          endStation: 20,
          width: 1,
          height: 0.1,
          profile: 'flat' as const,
          materialId: 'curb',
        },
        {
          id: 'b',
          side: 'left' as const,
          startStation: 10,
          endStation: 30,
          width: 1,
          height: 0.1,
          profile: 'flat' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);

    expect(validateCurbs(document, lookup).some((issue) => issue.message.includes('overlap'))).toBe(true);
  });
});
