import { normalizeStation, type StationLookup } from './stationing';
import type { StationValueCurve, StationValueKey, TrackValidationIssue } from './trackDocument';

export function evaluateStationValueCurve(
  curve: StationValueCurve | undefined,
  lookup: StationLookup,
  station: number,
  fallback = 0,
): number {
  const keys = sortedFiniteKeys(curve);
  if (keys.length === 0) {
    return fallback;
  }

  if (keys.length === 1 || lookup.totalLength <= 0) {
    return keys[0].value;
  }

  const normalizedStation = normalizeStation(station, lookup);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const before = keys[index];
    const after = keys[index + 1];
    if (normalizedStation >= before.station && normalizedStation <= after.station) {
      return interpolate(before.value, after.value, keyAlpha(before.station, after.station, normalizedStation));
    }
  }

  if (!lookup.closed) {
    return normalizedStation < keys[0].station ? keys[0].value : keys[keys.length - 1].value;
  }

  const first = keys[0];
  const last = keys[keys.length - 1];
  const wrappedAfterStation = first.station + lookup.totalLength;
  const wrappedStation = normalizedStation < first.station ? normalizedStation + lookup.totalLength : normalizedStation;
  return interpolate(last.value, first.value, keyAlpha(last.station, wrappedAfterStation, wrappedStation));
}

/**
 * Edits a station-value curve over a window centered on `centerStation`. At the
 * center the value becomes exactly `value`; moving away it eases back toward the
 * prior curve, reaching it at `radius` meters either side (smootherstep blend).
 * Keys outside the window are preserved. Mirrors `applyWidthFalloff` for banking
 * / elevation curves.
 */
export function applyStationValueFalloff(
  curve: StationValueCurve | undefined,
  lookup: StationLookup,
  centerStation: number,
  value: number,
  radius: number,
  samples = 8,
): StationValueCurve {
  const span = Math.max(radius, 1e-3);
  const center = normalizeStation(centerStation, lookup);

  const preserved = (curve?.keys ?? []).filter(
    (key) => wrappedDistance(key.station, center, lookup) > span + 1e-6,
  );

  const newKeys: StationValueKey[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const offset = -span + (2 * span * index) / samples;
    const sampleStation = normalizeStation(center + offset, lookup);
    const existing = evaluateStationValueCurve(curve, lookup, sampleStation);
    const distance = wrappedDistance(sampleStation, center, lookup);
    const weight = smootherStep(1 - Math.min(distance / span, 1));
    newKeys.push({ station: sampleStation, value: interpolate(existing, value, weight) });
  }
  newKeys.push({ station: center, value });

  const merged = [...preserved, ...newKeys]
    .sort((a, b) => a.station - b.station)
    .filter((key, index, all) => index === 0 || Math.abs(key.station - all[index - 1].station) > 1e-6);

  return { keys: merged };
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

export function stationValueDerivative(
  curve: StationValueCurve | undefined,
  lookup: StationLookup,
  station: number,
  fallback = 0,
): number {
  const step = Math.max(lookup.totalLength * 0.001, 0.25);
  const before = evaluateStationValueCurve(curve, lookup, station - step, fallback);
  const after = evaluateStationValueCurve(curve, lookup, station + step, fallback);
  return (after - before) / (step * 2);
}

export function validateStationValueCurve(
  label: string,
  curve: StationValueCurve | undefined,
  lookup?: StationLookup,
  options: { readonly maxAbsValue?: number; readonly unitLabel?: string } = {},
): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  const keys = curve?.keys ?? [];

  for (const key of keys) {
    if (!Number.isFinite(key.station) || !Number.isFinite(key.value)) {
      issues.push({
        severity: 'error',
        message: `${label} curve contains a non-finite key.`,
      });
      return issues;
    }

    if (lookup && key.station < 0) {
      issues.push({
        severity: 'warning',
        message: `${label} curve has a key before station zero.`,
      });
    }

    if (lookup && lookup.totalLength > 0 && key.station > lookup.totalLength) {
      issues.push({
        severity: 'warning',
        message: `${label} curve has a key beyond the track length.`,
      });
    }

    if (options.maxAbsValue !== undefined && Math.abs(key.value) > options.maxAbsValue) {
      issues.push({
        severity: 'warning',
        message: `${label} curve exceeds ${options.maxAbsValue}${options.unitLabel ?? ''}.`,
      });
      return issues;
    }
  }

  return issues;
}

function sortedFiniteKeys(curve: StationValueCurve | undefined): StationValueKey[] {
  return [...(curve?.keys ?? [])]
    .filter((key) => Number.isFinite(key.station) && Number.isFinite(key.value))
    .sort((a, b) => a.station - b.station);
}

function keyAlpha(start: number, end: number, station: number): number {
  return Math.min(Math.max((station - start) / Math.max(end - start, 1e-9), 0), 1);
}

function interpolate(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}
