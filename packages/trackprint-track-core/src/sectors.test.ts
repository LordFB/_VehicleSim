import { describe, expect, it } from 'vitest';
import { createStationLookup, findSectorAtStation, updateSectorTransition, validateSectors } from './index';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import type { TrackDocument } from './trackDocument';

describe('sectors', () => {
  it('finds the current sector', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    expect(findSectorAtStation(document, lookup, 20)?.id).toBe('sector-1');
  });

  it('rejects overlapping sectors', () => {
    const document: TrackDocument = {
      ...createDefaultTrackDocument(),
      sectors: [
        { id: 'a', name: 'A', startStation: 0, endStation: 100 },
        { id: 'b', name: 'B', startStation: 50, endStation: 150 },
      ],
    };
    const lookup = createStationLookup(document, 16);
    expect(validateSectors(document, lookup).some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('warns on sector gaps', () => {
    const document: TrackDocument = {
      ...createDefaultTrackDocument(),
      sectors: [
        { id: 'a', name: 'A', startStation: 0, endStation: 100 },
        { id: 'b', name: 'B', startStation: 150, endStation: 250 },
      ],
    };
    const lookup = createStationLookup(document, 16);
    expect(validateSectors(document, lookup).some((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('fires sector transitions once per sector change', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const first = updateSectorTransition(document, lookup, 20, { previousSectorId: null });
    const second = updateSectorTransition(document, lookup, 30, { previousSectorId: first.sector?.id ?? null });
    expect(first.transitioned).toBe(true);
    expect(second.transitioned).toBe(false);
  });
});
