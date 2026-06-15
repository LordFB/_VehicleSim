import { createSegment } from './cubicBezier';
import { repairTrackContinuity } from './continuity';
import type { Segment, TrackDocument } from './trackDocument';
import { distance, dot, isFiniteVector, leftNormal, subtract, type Vector2 } from './vector';

export interface StationSample {
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly t: number;
  readonly s: number;
  readonly position: Vector2;
}

export interface StationLookup {
  readonly closed: boolean;
  readonly samplesPerSegment: number;
  readonly segmentStartStations: number[];
  readonly segmentLengths: number[];
  readonly samples: StationSample[];
  readonly totalLength: number;
}

export interface StationEvaluation {
  readonly station: number;
  readonly segmentIndex: number;
  readonly segmentId: string;
  readonly t: number;
  readonly position: Vector2;
  readonly tangent: Vector2;
  readonly normal: Vector2;
}

export interface NearestStationResult extends StationEvaluation {
  readonly distance: number;
  readonly side: -1 | 0 | 1;
}

export function createStationLookup(document: TrackDocument, samplesPerSegment = 32): StationLookup {
  const safeSamplesPerSegment = Math.max(2, Math.floor(samplesPerSegment));
  const repairedDocument = repairTrackContinuity(document);
  const segments = repairedDocument.segments.map(createSegment);
  const samples: StationSample[] = [];
  const segmentStartStations: number[] = [];
  const segmentLengths: number[] = [];
  let station = 0;

  segments.forEach((segment, segmentIndex) => {
    const segmentStartStation = station;
    segmentStartStations.push(segmentStartStation);
    let previous = segment.evaluate(0);
    const startIndex = segmentIndex === 0 ? 0 : 1;

    for (let sampleIndex = startIndex; sampleIndex <= safeSamplesPerSegment; sampleIndex += 1) {
      const t = sampleIndex / safeSamplesPerSegment;
      const position = segment.evaluate(t);
      if (samples.length > 0) {
        station += distance(previous, position);
      }

      samples.push({
        segmentIndex,
        segmentId: segment.id,
        t,
        s: station,
        position,
      });
      previous = position;
    }

    segmentLengths.push(station - segmentStartStation);
  });

  return {
    closed: document.closed,
    samplesPerSegment: safeSamplesPerSegment,
    segmentStartStations,
    segmentLengths,
    samples,
    totalLength: station,
  };
}

export function getDocumentLength(lookup: StationLookup): number {
  return lookup.totalLength;
}

export function evaluateStation(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
): StationEvaluation {
  const repairedDocument = repairTrackContinuity(document);
  const wrappedStation = normalizeStation(station, lookup);
  const [before, after] = bracketStation(lookup, wrappedStation);
  const segment = createSegment(repairedDocument.segments[before.segmentIndex]);
  const segmentStationRange = Math.max(after.s - before.s, 1e-9);
  const localAlpha = (wrappedStation - before.s) / segmentStationRange;
  const t = before.t + (after.t - before.t) * localAlpha;
  const position = segment.evaluate(t);
  const tangent = segment.tangent(t);

  return {
    station: wrappedStation,
    segmentIndex: before.segmentIndex,
    segmentId: before.segmentId,
    t,
    position,
    tangent,
    normal: leftNormal(tangent),
  };
}

export function nearestStation(
  document: TrackDocument,
  lookup: StationLookup,
  point: Vector2,
): NearestStationResult {
  if (lookup.samples.length === 0) {
    throw new Error('Cannot query nearest station for an empty track.');
  }

  let bestSample = lookup.samples[0];
  let bestDistance = distance(bestSample.position, point);

  for (const sample of lookup.samples) {
    const candidateDistance = distance(sample.position, point);
    if (candidateDistance < bestDistance) {
      bestSample = sample;
      bestDistance = candidateDistance;
    }
  }

  const segment = createSegment(repairTrackContinuity(document).segments[bestSample.segmentIndex]);
  const refined = refineNearestOnSegment(segment, point, bestSample.t);
  const segmentStartStation = lookup.segmentStartStations[bestSample.segmentIndex] ?? 0;
  const approximateSegmentLength =
    lookup.segmentLengths[bestSample.segmentIndex] ?? segment.length(lookup.samplesPerSegment);
  const refinedStation = normalizeStation(
    segmentStartStation + approximateSegmentLength * refined.t,
    lookup,
  );
  const evaluation = evaluateStation(document, lookup, refinedStation);
  const lateral = dot(subtract(point, evaluation.position), evaluation.normal);

  return {
    ...evaluation,
    distance: distance(point, evaluation.position),
    side: Math.abs(lateral) < 1e-6 ? 0 : lateral > 0 ? 1 : -1,
  };
}

export function validateClosedLoop(document: TrackDocument, epsilon = 1e-4): string[] {
  if (!document.closed || document.segments.length === 0) {
    return [];
  }

  const issues: string[] = [];
  for (let index = 0; index < document.segments.length; index += 1) {
    const current = document.segments[index];
    const next = document.segments[(index + 1) % document.segments.length];
    if (distance(current.p3.position, next.p0.position) > epsilon) {
      issues.push(`Segment ${current.id} does not connect to ${next.id}.`);
    }
  }

  return issues;
}

export function normalizeStation(station: number, lookup: StationLookup): number {
  if (!Number.isFinite(station) || lookup.totalLength <= 0) {
    return 0;
  }

  if (lookup.closed) {
    return ((station % lookup.totalLength) + lookup.totalLength) % lookup.totalLength;
  }

  return Math.min(Math.max(station, 0), lookup.totalLength);
}

function bracketStation(lookup: StationLookup, station: number): [StationSample, StationSample] {
  if (lookup.samples.length < 2) {
    throw new Error('A station lookup requires at least two samples.');
  }

  for (let index = 0; index < lookup.samples.length - 1; index += 1) {
    const before = lookup.samples[index];
    const after = lookup.samples[index + 1];
    if (station >= before.s && station <= after.s) {
      return [before, after];
    }
  }

  return [lookup.samples[lookup.samples.length - 2], lookup.samples[lookup.samples.length - 1]];
}

function refineNearestOnSegment(segment: Segment, point: Vector2, initialT: number) {
  let bestT = initialT;
  let bestPosition = segment.evaluate(bestT);
  let bestDistance = distance(point, bestPosition);
  let radius = 1 / 16;

  for (let pass = 0; pass < 8; pass += 1) {
    const start = Math.max(0, bestT - radius);
    const end = Math.min(1, bestT + radius);
    for (let index = 0; index <= 8; index += 1) {
      const t = start + ((end - start) * index) / 8;
      const position = segment.evaluate(t);
      const candidateDistance = distance(point, position);
      if (candidateDistance < bestDistance && isFiniteVector(position)) {
        bestT = t;
        bestPosition = position;
        bestDistance = candidateDistance;
      }
    }
    radius *= 0.5;
  }

  return { t: bestT, position: bestPosition, distance: bestDistance };
}
