import type { StationLookup } from './stationing';
import { normalizeStation } from './stationing';
import type { TrackDocument } from './trackDocument';

export type StationCutSourceType =
  | 'segment-boundary'
  | 'width-key'
  | 'sector-boundary'
  | 'curb-interval'
  | 'runoff-interval'
  | 'profile-repeat'
  | 'material-interval'
  | 'adaptive-curvature';

export interface StationCut {
  readonly station: number;
  readonly sourceType: StationCutSourceType;
  readonly sourceId: string;
  readonly locked: boolean;
  readonly optional: boolean;
}

export interface ProcessedStationCut extends StationCut {
  readonly sources: readonly StationCut[];
}

export interface StationCutProcessingResult {
  readonly cuts: readonly ProcessedStationCut[];
  readonly warnings: readonly string[];
}

export function collectStationCuts(
  document: TrackDocument,
  lookup: StationLookup,
  adaptiveCutCount = 96,
): StationCut[] {
  return [
    ...collectSegmentBoundaryCuts(document, lookup),
    ...collectWidthKeyCuts(document, lookup),
    ...collectSectorBoundaryCuts(document, lookup),
    ...collectCurbCuts(document, lookup),
    ...collectRunoffCuts(document, lookup),
    ...collectAdaptiveCuts(lookup, adaptiveCutCount),
  ];
}

export function processStationCuts(
  cuts: readonly StationCut[],
  lookup: StationLookup,
  epsilon = 1e-4,
  minimumSpacing = 0.05,
): StationCutProcessingResult {
  const normalizedCuts = cuts
    .map((cut) => ({ ...cut, station: normalizeStation(cut.station, lookup) }))
    .sort((a, b) => a.station - b.station || sourceRank(a) - sourceRank(b));
  const processed: ProcessedStationCut[] = [];
  const warnings: string[] = [];

  for (const cut of normalizedCuts) {
    const previous = processed[processed.length - 1];
    if (previous && Math.abs(previous.station - cut.station) <= epsilon) {
      processed[processed.length - 1] = mergeCuts(previous, cut);
      continue;
    }

    processed.push({ ...cut, sources: [cut] });
  }

  if (lookup.closed && processed.length > 1) {
    const first = processed[0];
    const last = processed[processed.length - 1];
    if (Math.abs(first.station + lookup.totalLength - last.station) <= epsilon) {
      processed[0] = mergeCuts(first, last);
      processed.pop();
    }
  }

  for (let index = 1; index < processed.length; index += 1) {
    const spacing = processed[index].station - processed[index - 1].station;
    if (spacing > 0 && spacing < minimumSpacing) {
      warnings.push(
        `Station cuts ${processed[index - 1].sourceId} and ${processed[index].sourceId} are very close.`,
      );
    }
  }

  return { cuts: processed, warnings };
}

function collectSegmentBoundaryCuts(document: TrackDocument, lookup: StationLookup): StationCut[] {
  return document.segments.map((segment, index) => ({
    station: lookup.segmentStartStations[index] ?? 0,
    sourceType: 'segment-boundary',
    sourceId: segment.id,
    locked: true,
    optional: false,
  }));
}

function collectWidthKeyCuts(document: TrackDocument, lookup: StationLookup): StationCut[] {
  const cuts: StationCut[] = [];
  for (const [side, widthSide] of [
    ['left', document.width?.left],
    ['right', document.width?.right],
  ] as const) {
    for (const key of widthSide?.keys ?? []) {
      cuts.push({
        station: normalizeStation(key.station, lookup),
        sourceType: 'width-key',
        sourceId: `${side}:${key.station}`,
        locked: true,
        optional: false,
      });
    }
  }
  return cuts;
}

function collectSectorBoundaryCuts(document: TrackDocument, lookup: StationLookup): StationCut[] {
  const cuts: StationCut[] = [];
  for (const sector of document.sectors ?? []) {
    cuts.push({
      station: normalizeStation(sector.startStation, lookup),
      sourceType: 'sector-boundary',
      sourceId: `${sector.id}:start`,
      locked: true,
      optional: false,
    });
    cuts.push({
      station: normalizeStation(sector.endStation, lookup),
      sourceType: 'sector-boundary',
      sourceId: `${sector.id}:end`,
      locked: true,
      optional: false,
    });
  }
  return cuts;
}

function collectCurbCuts(document: TrackDocument, lookup: StationLookup): StationCut[] {
  const cuts: StationCut[] = [];
  for (const curb of document.curbs ?? []) {
    cuts.push({
      station: normalizeStation(curb.startStation, lookup),
      sourceType: 'curb-interval',
      sourceId: `${curb.id}:start`,
      locked: true,
      optional: false,
    });
    cuts.push({
      station: normalizeStation(curb.endStation, lookup),
      sourceType: 'curb-interval',
      sourceId: `${curb.id}:end`,
      locked: true,
      optional: false,
    });
    if (curb.profile === 'sawtooth') {
      const start = normalizeStation(curb.startStation, lookup);
      const end = normalizeStation(curb.endStation, lookup);
      const span = end >= start ? end - start : lookup.totalLength - start + end;
      const repeats = Math.max(0, Math.floor(span / 4));
      for (let index = 1; index < repeats; index += 1) {
        cuts.push({
          station: normalizeStation(start + index * 4, lookup),
          sourceType: 'profile-repeat',
          sourceId: `${curb.id}:repeat:${index}`,
          locked: false,
          optional: true,
        });
      }
    }
  }
  return cuts;
}

function collectRunoffCuts(document: TrackDocument, lookup: StationLookup): StationCut[] {
  const cuts: StationCut[] = [];
  for (const runoff of document.runoffs ?? []) {
    cuts.push({
      station: normalizeStation(runoff.startStation, lookup),
      sourceType: 'runoff-interval',
      sourceId: `${runoff.id}:start`,
      locked: true,
      optional: false,
    });
    cuts.push({
      station: normalizeStation(runoff.endStation, lookup),
      sourceType: 'runoff-interval',
      sourceId: `${runoff.id}:end`,
      locked: true,
      optional: false,
    });
  }
  return cuts;
}

function collectAdaptiveCuts(lookup: StationLookup, adaptiveCutCount: number): StationCut[] {
  const count = Math.max(2, Math.floor(adaptiveCutCount));
  const denominator = lookup.closed ? count : count - 1;
  return Array.from({ length: count }, (_, index) => ({
    station: lookup.totalLength <= 0 ? 0 : (lookup.totalLength * index) / denominator,
    sourceType: 'adaptive-curvature',
    sourceId: `adaptive:${index}`,
    locked: false,
    optional: true,
  }));
}

function mergeCuts(a: ProcessedStationCut, b: StationCut): ProcessedStationCut {
  const sources = [...a.sources, b];
  const forced = sources.find((source) => !source.optional) ?? sources[0];
  return {
    ...forced,
    station: forced.station,
    locked: sources.some((source) => source.locked),
    optional: sources.every((source) => source.optional),
    sources,
  };
}

function sourceRank(cut: StationCut): number {
  return cut.optional ? 1 : 0;
}
