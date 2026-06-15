import { normalizeStation, type StationLookup } from './stationing';
import type {
  CurbInterval,
  RunoffInterval,
  TrackDocument,
  TrackSide,
  TrackValidationIssue,
} from './trackDocument';

export type SurfaceInterval = CurbInterval | RunoffInterval;

export const defaultTrackLimits = {
  curbIsValid: true,
  runoffIsValid: false,
};

export function isStationInInterval(
  station: number,
  startStation: number,
  endStation: number,
  lookup: StationLookup,
): boolean {
  const stationValue = normalizeStation(station, lookup);
  const start = normalizeStation(startStation, lookup);
  const end = normalizeStation(endStation, lookup);

  if (Math.abs(start - end) <= 1e-6 && lookup.closed) {
    return true;
  }

  if (start <= end) {
    return stationValue >= start - 1e-6 && stationValue <= end + 1e-6;
  }

  return stationValue >= start - 1e-6 || stationValue <= end + 1e-6;
}

export function findActiveCurb(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
  side: TrackSide,
): CurbInterval | null {
  return (
    (document.curbs ?? []).find(
      (curb) =>
        curb.side === side &&
        isStationInInterval(station, curb.startStation, curb.endStation, lookup),
    ) ?? null
  );
}

export function findActiveRunoff(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
  side: TrackSide,
): RunoffInterval | null {
  return (
    (document.runoffs ?? []).find(
      (runoff) =>
        runoff.side === side &&
        isStationInInterval(station, runoff.startStation, runoff.endStation, lookup),
    ) ?? null
  );
}

export function validateCurbs(
  document: TrackDocument,
  lookup: StationLookup,
): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  for (const curb of document.curbs ?? []) {
    if (!Number.isFinite(curb.width) || curb.width < 0) {
      issues.push({ severity: 'error', message: `Curb ${curb.id} width cannot be negative.` });
    }
    if (!Number.isFinite(curb.height) || curb.height < 0) {
      issues.push({ severity: 'error', message: `Curb ${curb.id} height cannot be negative.` });
    }
    if (curb.taperLength !== undefined && (!Number.isFinite(curb.taperLength) || curb.taperLength < 0)) {
      issues.push({ severity: 'error', message: `Curb ${curb.id} taper length cannot be negative.` });
    }
    warnIfOutOfRange('Curb', curb.id, curb.startStation, lookup, issues);
    warnIfOutOfRange('Curb', curb.id, curb.endStation, lookup, issues);
  }

  detectOverlaps('Curb', document.curbs ?? [], lookup, issues);
  return issues;
}

export function validateRunoffs(
  document: TrackDocument,
  lookup: StationLookup,
): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  for (const runoff of document.runoffs ?? []) {
    if (!Number.isFinite(runoff.width) || runoff.width < 0) {
      issues.push({ severity: 'error', message: `Runoff ${runoff.id} width cannot be negative.` });
    }
    if (runoff.taperLength !== undefined && (!Number.isFinite(runoff.taperLength) || runoff.taperLength < 0)) {
      issues.push({ severity: 'error', message: `Runoff ${runoff.id} taper length cannot be negative.` });
    }
    warnIfOutOfRange('Runoff', runoff.id, runoff.startStation, lookup, issues);
    warnIfOutOfRange('Runoff', runoff.id, runoff.endStation, lookup, issues);
  }

  detectOverlaps('Runoff', document.runoffs ?? [], lookup, issues);
  return issues;
}

function warnIfOutOfRange(
  label: string,
  id: string,
  station: number,
  lookup: StationLookup,
  issues: TrackValidationIssue[],
) {
  if (station < 0 || station > lookup.totalLength) {
    issues.push({
      severity: 'warning',
      message: `${label} ${id} station will be clamped to the track length.`,
    });
  }
}

function detectOverlaps(
  label: string,
  intervals: readonly SurfaceInterval[],
  lookup: StationLookup,
  issues: TrackValidationIssue[],
) {
  for (const side of ['left', 'right'] as const) {
    const sideIntervals = intervals.filter((interval) => interval.side === side);
    for (let a = 0; a < sideIntervals.length; a += 1) {
      for (let b = a + 1; b < sideIntervals.length; b += 1) {
        if (intervalsOverlap(sideIntervals[a], sideIntervals[b], lookup)) {
          issues.push({
            severity: 'error',
            message: `${label} intervals overlap on the ${side} side.`,
          });
          return;
        }
      }
    }
  }
}

function intervalsOverlap(a: SurfaceInterval, b: SurfaceInterval, lookup: StationLookup): boolean {
  return (
    isStationInInterval(a.startStation, b.startStation, b.endStation, lookup) ||
    isStationInInterval(a.endStation, b.startStation, b.endStation, lookup) ||
    isStationInInterval(b.startStation, a.startStation, a.endStation, lookup)
  );
}
