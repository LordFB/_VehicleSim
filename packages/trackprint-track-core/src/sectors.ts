import type { StationLookup } from './stationing';
import { normalizeStation } from './stationing';
import type { TrackDocument, TrackSector, TrackValidationIssue } from './trackDocument';

export interface SectorTransitionState {
  readonly previousSectorId: string | null;
}

export interface SectorTransitionResult {
  readonly sector: TrackSector | null;
  readonly transitioned: boolean;
}

export function validateSectors(document: TrackDocument, lookup: StationLookup): TrackValidationIssue[] {
  const sectors = document.sectors ?? [];
  const issues: TrackValidationIssue[] = [];
  const intervals = sectors.flatMap((sector) => unwrapSector(sector, lookup));

  for (let index = 0; index < intervals.length; index += 1) {
    for (let other = index + 1; other < intervals.length; other += 1) {
      if (intervalsOverlap(intervals[index], intervals[other])) {
        issues.push({
          severity: 'error',
          message: `Sector ${intervals[index].sector.id} overlaps ${intervals[other].sector.id}.`,
        });
      }
    }
  }

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start > sorted[index - 1].end + 1e-4) {
      issues.push({
        severity: 'warning',
        message: 'Sector coverage has a gap.',
      });
      break;
    }
  }

  return issues;
}

export function findSectorAtStation(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
): TrackSector | null {
  const normalized = normalizeStation(station, lookup);
  return (
    (document.sectors ?? []).find((sector) =>
      unwrapSector(sector, lookup).some(
        (interval) => normalized >= interval.start && normalized < interval.end,
      ),
    ) ?? null
  );
}

export function updateSectorTransition(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
  state: SectorTransitionState,
): SectorTransitionResult {
  const sector = findSectorAtStation(document, lookup, station);
  return {
    sector,
    transitioned: (sector?.id ?? null) !== state.previousSectorId,
  };
}

function unwrapSector(sector: TrackSector, lookup: StationLookup) {
  const start = normalizeStation(sector.startStation, lookup);
  const end = normalizeStation(sector.endStation, lookup);
  if (!lookup.closed || start <= end) {
    return [{ sector, start, end: end <= start ? lookup.totalLength : end }];
  }
  return [
    { sector, start, end: lookup.totalLength },
    { sector, start: 0, end },
  ];
}

function intervalsOverlap(
  a: { readonly start: number; readonly end: number },
  b: { readonly start: number; readonly end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}
