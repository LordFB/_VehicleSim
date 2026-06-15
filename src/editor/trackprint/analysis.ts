import {
  evaluateStation,
  evaluateStationValueCurve,
  stationValueDerivative,
  type StationLookup,
  type TrackDocument,
} from '@trackprint/track-core';

export type AnalysisOverlayMode = 'solid' | 'curvature' | 'slope' | 'banking' | 'severity';

export interface AnalysisSample {
  readonly station: number;
  readonly curvature: number;
  readonly gradePercent: number;
  readonly bankingRadians: number;
  readonly bankingRate: number;
  readonly severity: number;
  readonly estimatedSpeed: number;
  readonly braking: boolean;
}

export interface AnalysisResult {
  readonly samples: readonly AnalysisSample[];
  readonly curvatureRange: readonly [number, number];
  readonly gradeRange: readonly [number, number];
  readonly bankingRange: readonly [number, number];
  readonly peakStations: readonly number[];
  readonly straightStations: readonly number[];
}

export interface TelemetrySample {
  readonly time: number;
  readonly station: number;
  readonly speed: number;
  readonly offTrack: boolean;
}

export interface TelemetryState {
  readonly samples: readonly TelemetrySample[];
  readonly bestSectorTimes: Readonly<Record<string, number>>;
  readonly currentSectorDeltas: Readonly<Record<string, number>>;
}

export function analyzeTrack(document: TrackDocument, lookup: StationLookup, sampleCount = 96): AnalysisResult {
  const length = Math.max(lookup.totalLength, 1);
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const station = (index / sampleCount) * length;
    const previous = evaluateStation(document, lookup, station - 1);
    const current = evaluateStation(document, lookup, station);
    const next = evaluateStation(document, lookup, station + 1);
    const headingA = Math.atan2(current.tangent.y, current.tangent.x) - Math.atan2(previous.tangent.y, previous.tangent.x);
    const headingB = Math.atan2(next.tangent.y, next.tangent.x) - Math.atan2(current.tangent.y, current.tangent.x);
    const curvature = Math.abs(normalizeAngle(headingA) + normalizeAngle(headingB)) / 2;
    const slope = stationValueDerivative(document.elevation, lookup, station);
    const banking = evaluateStationValueCurve(document.banking, lookup, station);
    const bankingRate = stationValueDerivative(document.banking, lookup, station);
    const severity = clamp01(curvature * 18 + Math.abs(slope) * 0.7 + Math.abs(bankingRate) * 12);
    return {
      station,
      curvature,
      gradePercent: slope * 100,
      bankingRadians: banking,
      bankingRate,
      severity,
      estimatedSpeed: Math.max(45, 180 - severity * 120),
      braking: severity > 0.5,
    };
  });

  return {
    samples,
    curvatureRange: range(samples.map((sample) => sample.curvature)),
    gradeRange: range(samples.map((sample) => sample.gradePercent)),
    bankingRange: range(samples.map((sample) => sample.bankingRadians)),
    peakStations: samples.filter((sample) => sample.curvature > 0.02).map((sample) => sample.station),
    straightStations: samples.filter((sample) => sample.curvature < 0.004).map((sample) => sample.station),
  };
}

export function updateTelemetry(
  telemetry: TelemetryState,
  sample: TelemetrySample,
  currentSectorId: string | null,
): TelemetryState {
  const samples = [...telemetry.samples.slice(-239), sample];
  if (!currentSectorId) {
    return { ...telemetry, samples };
  }

  const previous = telemetry.bestSectorTimes[currentSectorId] ?? Number.POSITIVE_INFINITY;
  const sectorTime = sample.time;
  const best = Math.min(previous, sectorTime);
  return {
    samples,
    bestSectorTimes: { ...telemetry.bestSectorTimes, [currentSectorId]: best },
    currentSectorDeltas: { ...telemetry.currentSectorDeltas, [currentSectorId]: sectorTime - best },
  };
}

export function initialTelemetry(): TelemetryState {
  return { samples: [], bestSectorTimes: {}, currentSectorDeltas: {} };
}

function range(values: readonly number[]): readonly [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
