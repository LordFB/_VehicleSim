import { isStationInInterval } from './surfaceBands';
import { type StationLookup } from './stationing';
import type {
  StructureSpan,
  TrackDocument,
  TrackSide,
  TrackValidationIssue,
  TunnelInterval,
} from './trackDocument';

// Resolve every authored tunnel and every bridged segment into a single
// StructureSpan list. This is the one source of truth consumed by the
// compiler (geometry) and the editor (terrain suppression). Tunnels keep their
// per-side skew; bridges map a segment's [start, start+length] range to both
// sides equally.
export function resolveStructureSpans(document: TrackDocument, lookup: StationLookup): StructureSpan[] {
  const spans: StructureSpan[] = [];

  for (const tunnel of document.tunnels ?? []) {
    spans.push({
      id: tunnel.id,
      kind: 'tunnel',
      startStation: Math.min(tunnel.leftStartStation, tunnel.rightStartStation),
      endStation: Math.max(tunnel.leftEndStation, tunnel.rightEndStation),
      left: { start: tunnel.leftStartStation, end: tunnel.leftEndStation },
      right: { start: tunnel.rightStartStation, end: tunnel.rightEndStation },
    });
  }

  document.segments.forEach((segment, index) => {
    if (!segment.bridge) {
      return;
    }
    const start = lookup.segmentStartStations[index] ?? 0;
    const end = start + (lookup.segmentLengths[index] ?? 0);
    spans.push({
      id: segment.id,
      kind: 'bridge',
      startStation: start,
      endStation: end,
      left: { start, end },
      right: { start, end },
    });
  });

  return spans;
}

export function isStationInStructure(
  span: StructureSpan,
  side: TrackSide,
  station: number,
  lookup: StationLookup,
): boolean {
  const range = side === 'left' ? span.left : span.right;
  return isStationInInterval(station, range.start, range.end, lookup);
}

export function validateTunnels(document: TrackDocument, lookup: StationLookup): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  for (const tunnel of document.tunnels ?? []) {
    if (!Number.isFinite(tunnel.width) || tunnel.width <= 0) {
      issues.push({ severity: 'error', message: `Tunnel ${tunnel.id} width must be positive.` });
    }
    if (!Number.isFinite(tunnel.height) || tunnel.height <= 0) {
      issues.push({ severity: 'error', message: `Tunnel ${tunnel.id} height must be positive.` });
    }
    for (const station of [
      tunnel.leftStartStation,
      tunnel.leftEndStation,
      tunnel.rightStartStation,
      tunnel.rightEndStation,
    ]) {
      warnIfOutOfRange('Tunnel', tunnel.id, station, lookup, issues);
    }
  }

  detectTunnelOverlaps(document.tunnels ?? [], lookup, issues);
  return issues;
}

export function validateBridges(document: TrackDocument, lookup: StationLookup): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  document.segments.forEach((segment, index) => {
    if (!segment.bridge) {
      return;
    }
    const length = lookup.segmentLengths[index] ?? 0;
    if (length <= 1e-6) {
      issues.push({
        severity: 'warning',
        message: `Bridge segment ${segment.id} has zero length.`,
        segmentId: segment.id,
      });
    }
  });

  detectTunnelBridgeOverlaps(document, lookup, issues);
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

// Tunnels on the same physical span overlap if either of their per-side ranges
// overlaps. Each side is checked independently so a skew that staggers only one
// wall is still caught.
function detectTunnelOverlaps(
  tunnels: readonly TunnelInterval[],
  lookup: StationLookup,
  issues: TrackValidationIssue[],
) {
  for (let a = 0; a < tunnels.length; a += 1) {
    for (let b = a + 1; b < tunnels.length; b += 1) {
      if (
        rangesOverlap(
          tunnels[a].leftStartStation,
          tunnels[a].leftEndStation,
          tunnels[b].leftStartStation,
          tunnels[b].leftEndStation,
          lookup,
        ) ||
        rangesOverlap(
          tunnels[a].rightStartStation,
          tunnels[a].rightEndStation,
          tunnels[b].rightStartStation,
          tunnels[b].rightEndStation,
          lookup,
        )
      ) {
        issues.push({ severity: 'error', message: 'Tunnel intervals overlap.' });
        return;
      }
    }
  }
}

function detectTunnelBridgeOverlaps(
  document: TrackDocument,
  lookup: StationLookup,
  issues: TrackValidationIssue[],
) {
  const spans = resolveStructureSpans(document, lookup);
  const tunnels = spans.filter((span) => span.kind === 'tunnel');
  const bridges = spans.filter((span) => span.kind === 'bridge');
  for (const tunnel of tunnels) {
    for (const bridge of bridges) {
      if (rangesOverlap(tunnel.startStation, tunnel.endStation, bridge.startStation, bridge.endStation, lookup)) {
        issues.push({
          severity: 'warning',
          message: `Tunnel ${tunnel.id} overlaps bridge segment ${bridge.id}.`,
        });
      }
    }
  }
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  lookup: StationLookup,
): boolean {
  return (
    isStationInInterval(aStart, bStart, bEnd, lookup) ||
    isStationInInterval(aEnd, bStart, bEnd, lookup) ||
    isStationInInterval(bStart, aStart, aEnd, lookup)
  );
}
