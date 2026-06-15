import type { TrackDocument, TrackValidationIssue, TrackWidth, TrackWidthSide, WidthKey } from './trackDocument';
import type { StationLookup } from './stationing';
import { normalizeStation } from './stationing';

export interface EvaluatedTrackWidth {
  readonly station: number;
  readonly left: number;
  readonly right: number;
  readonly total: number;
}

export const defaultTrackWidth: TrackWidth = {
  left: { constant: 6 },
  right: { constant: 6 },
};

export function getTrackWidth(document: TrackDocument): TrackWidth {
  return document.width ?? defaultTrackWidth;
}

export function createConstantTrackWidth(left: number, right: number): TrackWidth {
  return {
    left: { constant: left },
    right: { constant: right },
  };
}

export function evaluateTrackWidth(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
): EvaluatedTrackWidth {
  const width = getTrackWidth(document);
  const normalizedStation = normalizeStation(station, lookup);
  const left = evaluateWidthSide(width.left, lookup, normalizedStation);
  const right = evaluateWidthSide(width.right, lookup, normalizedStation);

  return {
    station: normalizedStation,
    left,
    right,
    total: left + right,
  };
}

/**
 * Edits a width side over a station range centered on `centerStation`. At the
 * center the width becomes exactly `value`; moving away it eases back toward
 * whatever the width was before the edit, reaching the prior width at
 * `radius` meters either side (smootherstep blend). Keys outside the range are
 * preserved, so localized bumps/notches compose without disturbing the rest of
 * the track.
 */
export function applyWidthFalloff(
  side: TrackWidthSide,
  lookup: StationLookup,
  centerStation: number,
  value: number,
  radius: number,
  samples = 8,
): TrackWidthSide {
  const span = Math.max(radius, 1e-3);
  const center = normalizeStation(centerStation, lookup);

  // Keys that fall outside the affected window are kept verbatim. On a closed
  // loop "outside" is measured by wrapped distance so the window straddling
  // the seam still excludes the right keys.
  const preserved = (side.keys ?? []).filter(
    (key) => wrappedDistance(key.station, center, lookup) > span + 1e-6,
  );

  // Sample the window at a fixed cadence (plus the exact center) and blend the
  // prior width toward the target. Sampling the existing curve — rather than
  // just the constant — means the taper returns to the real prior shape.
  const newKeys: WidthKey[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const offset = -span + (2 * span * index) / samples;
    const sampleStation = normalizeStation(center + offset, lookup);
    newKeys.push(makeFalloffKey(side, lookup, sampleStation, center, value, span));
  }
  // Guarantee the center hits the target exactly even if it fell between samples.
  newKeys.push({ station: center, value });

  const merged = [...preserved, ...newKeys]
    .sort((a, b) => a.station - b.station)
    .filter((key, index, all) => index === 0 || Math.abs(key.station - all[index - 1].station) > 1e-6);

  return { ...side, keys: merged };
}

function makeFalloffKey(
  side: TrackWidthSide,
  lookup: StationLookup,
  sampleStation: number,
  center: number,
  value: number,
  span: number,
): WidthKey {
  const existing = evaluateWidthSide(side, lookup, sampleStation);
  const distance = wrappedDistance(sampleStation, center, lookup);
  const weight = smootherStep(1 - Math.min(distance / span, 1));
  return { station: sampleStation, value: interpolate(existing, value, weight) };
}

// Shortest station distance accounting for the loop seam on closed tracks.
function wrappedDistance(a: number, b: number, lookup: StationLookup): number {
  const raw = Math.abs(a - b);
  if (!lookup.closed || lookup.totalLength <= 0) {
    return raw;
  }
  return Math.min(raw, lookup.totalLength - raw);
}

function smootherStep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function validateTrackWidth(
  document: TrackDocument,
  lookup?: StationLookup,
): TrackValidationIssue[] {
  const width = getTrackWidth(document);
  const issues: TrackValidationIssue[] = [];
  validateSide('left', width.left, issues);
  validateSide('right', width.right, issues);

  const totalConstant = width.left.constant + width.right.constant;
  if (totalConstant <= 0) {
    issues.push({
      severity: 'error',
      message: 'Track width must have a positive total width.',
    });
  }

  if (lookup) {
    warnOnChangeRate('left', width.left, lookup, issues);
    warnOnChangeRate('right', width.right, lookup, issues);
  }

  return issues;
}

function evaluateWidthSide(side: TrackWidthSide, lookup: StationLookup, station: number): number {
  const keys = [...(side.keys ?? [])]
    .filter((key) => Number.isFinite(key.station) && Number.isFinite(key.value))
    .sort((a, b) => a.station - b.station);

  if (keys.length === 0) {
    return side.constant;
  }

  if (keys.length === 1 || lookup.totalLength <= 0) {
    return keys[0].value;
  }

  const keyedStation = normalizeStation(station, lookup);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const before = keys[index];
    const after = keys[index + 1];
    if (keyedStation >= before.station && keyedStation <= after.station) {
      return interpolate(before.value, after.value, keyAlpha(before.station, after.station, keyedStation));
    }
  }

  if (!lookup.closed) {
    return keyedStation < keys[0].station ? keys[0].value : keys[keys.length - 1].value;
  }

  const last = keys[keys.length - 1];
  const first = keys[0];
  const wrappedAfterStation = first.station + lookup.totalLength;
  const wrappedStation = keyedStation < first.station ? keyedStation + lookup.totalLength : keyedStation;
  return interpolate(last.value, first.value, keyAlpha(last.station, wrappedAfterStation, wrappedStation));
}

function validateSide(
  label: 'left' | 'right',
  side: TrackWidthSide,
  issues: TrackValidationIssue[],
) {
  const values = [side.constant, ...(side.keys ?? []).map((key) => key.value)];
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({
        severity: 'error',
        message: `${label} width cannot be negative.`,
      });
      return;
    }
  }
}

function warnOnChangeRate(
  label: 'left' | 'right',
  side: TrackWidthSide,
  lookup: StationLookup,
  issues: TrackValidationIssue[],
) {
  const keys = [...(side.keys ?? [])].sort((a, b) => a.station - b.station);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const stationDelta = Math.max(Math.abs(keys[index + 1].station - keys[index].station), 1e-9);
    const widthDelta = Math.abs(keys[index + 1].value - keys[index].value);
    if (widthDelta / stationDelta > 0.4) {
      issues.push({
        severity: 'warning',
        message: `${label} width changes too quickly between keyed stations.`,
      });
      return;
    }
  }

  if (lookup.closed && keys.length > 1) {
    const first = keys[0];
    const last = keys[keys.length - 1];
    const stationDelta = Math.max(first.station + lookup.totalLength - last.station, 1e-9);
    const widthDelta = Math.abs(first.value - last.value);
    if (widthDelta / stationDelta > 0.4) {
      issues.push({
        severity: 'warning',
        message: `${label} width changes too quickly across the loop seam.`,
      });
    }
  }
}

function keyAlpha(start: number, end: number, station: number): number {
  return Math.min(Math.max((station - start) / Math.max(end - start, 1e-9), 0), 1);
}

function interpolate(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}
