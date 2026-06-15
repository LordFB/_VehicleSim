import type { CubicBezierSegmentDocument, TrackDocument, TrackSegmentDocument } from './trackDocument';
import type { Vector2 } from './vector';

export function repairTrackContinuity(document: TrackDocument): TrackDocument {
  const anchorPositions = collectWeldedAnchorPositions(document);
  const positionRepairedSegments = document.segments.map((segment) =>
    repairSharedAnchorPositions(segment, anchorPositions),
  );

  return {
    ...document,
    segments: smoothOrderedSegments({ ...document, segments: positionRepairedSegments }),
  };
}

function collectWeldedAnchorPositions(document: TrackDocument): Map<string, Vector2> {
  const anchorPositions = new Map<string, Vector2>();
  const groups: AnchorOccurrence[][] = [];
  const consumed = new Set<string>();

  document.segments.forEach((_, segmentIndex) => {
    for (const role of ['p0', 'p3'] as const) {
      const seed = { segmentIndex, role };
      const key = occurrenceKey(seed);
      if (consumed.has(key)) {
        continue;
      }

      const group = collectAnchorGroup(document, seed);
      group.forEach((occurrence) => consumed.add(occurrenceKey(occurrence)));
      groups.push(group);
    }
  });

  for (const group of groups) {
    const canonicalPosition = anchorAt(document, group[0]).position;
    for (const occurrence of group) {
      anchorPositions.set(anchorAt(document, occurrence).id, canonicalPosition);
    }
  }

  return anchorPositions;
}

interface AnchorOccurrence {
  readonly segmentIndex: number;
  readonly role: 'p0' | 'p3';
}

function collectAnchorGroup(
  document: TrackDocument,
  seed: AnchorOccurrence,
): AnchorOccurrence[] {
  const queue = [seed];
  const result: AnchorOccurrence[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const occurrence = queue.shift() as AnchorOccurrence;
    const key = occurrenceKey(occurrence);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(occurrence);
    const anchorId = anchorAt(document, occurrence).id;

    document.segments.forEach((segment, segmentIndex) => {
      if (segment.p0.id === anchorId) {
        queue.push({ segmentIndex, role: 'p0' });
      }
      if (segment.p3.id === anchorId) {
        queue.push({ segmentIndex, role: 'p3' });
      }
    });

    const orderedNeighbor = connectedBySegmentOrder(document, occurrence);
    if (orderedNeighbor) {
      queue.push(orderedNeighbor);
    }
  }

  return result;
}

function connectedBySegmentOrder(
  document: TrackDocument,
  occurrence: AnchorOccurrence,
): AnchorOccurrence | null {
  if (document.segments.length < 2) {
    return null;
  }

  if (occurrence.role === 'p3') {
    const nextSegmentIndex = occurrence.segmentIndex + 1;
    if (nextSegmentIndex < document.segments.length) {
      return { segmentIndex: nextSegmentIndex, role: 'p0' };
    }
    return document.closed ? { segmentIndex: 0, role: 'p0' } : null;
  }

  const previousSegmentIndex = occurrence.segmentIndex - 1;
  if (previousSegmentIndex >= 0) {
    return { segmentIndex: previousSegmentIndex, role: 'p3' };
  }
  return document.closed ? { segmentIndex: document.segments.length - 1, role: 'p3' } : null;
}

function anchorAt(document: TrackDocument, occurrence: AnchorOccurrence) {
  const segment = document.segments[occurrence.segmentIndex];
  return occurrence.role === 'p0' ? segment.p0 : segment.p3;
}

function occurrenceKey(occurrence: AnchorOccurrence): string {
  return `${occurrence.segmentIndex}:${occurrence.role}`;
}

function repairSharedAnchorPositions(
  segment: TrackSegmentDocument,
  anchorPositions: ReadonlyMap<string, Vector2>,
): CubicBezierSegmentDocument {
  return {
    ...segment,
    p0: { ...segment.p0, position: anchorPositions.get(segment.p0.id) ?? segment.p0.position },
    p3: { ...segment.p3, position: anchorPositions.get(segment.p3.id) ?? segment.p3.position },
  };
}

function smoothOrderedSegments(document: TrackDocument): CubicBezierSegmentDocument[] {
  if (document.segments.length === 0) {
    return [];
  }

  const anchors = orderedAnchors(document);
  const tangents = anchors.map((_, index) => anchorTangent(anchors, index, document.closed));
  const handleLengths = anchors.map((_, index) => anchorHandleLength(anchors, index, document.closed));

  return document.segments.map((segment, index) => {
    const startIndex = index;
    const endIndex = document.closed ? (index + 1) % anchors.length : index + 1;
    const start = anchors[startIndex];
    const end = anchors[endIndex];

    return {
      ...segment,
      p0: { ...segment.p0, position: start },
      p1: { ...segment.p1, position: add(start, scale(tangents[startIndex], handleLengths[startIndex])) },
      p2: { ...segment.p2, position: subtract(end, scale(tangents[endIndex], handleLengths[endIndex])) },
      p3: { ...segment.p3, position: end },
    };
  });
}

function orderedAnchors(document: TrackDocument): Vector2[] {
  const anchors: Vector2[] = [];
  const first = document.segments[0];
  anchors.push(first.p0.position);

  for (const segment of document.segments) {
    anchors.push(segment.p3.position);
  }

  if (document.closed) {
    anchors.pop();
  }

  return anchors;
}

function anchorTangent(anchors: readonly Vector2[], index: number, closed: boolean): Vector2 {
  if (anchors.length < 2) {
    return { x: 1, y: 0 };
  }

  if (closed) {
    const previous = anchors[(index - 1 + anchors.length) % anchors.length];
    const next = anchors[(index + 1) % anchors.length];
    return normalize(subtract(next, previous), segmentFallback(anchors, index, closed));
  }

  if (index === 0) {
    return normalize(subtract(anchors[1], anchors[0]));
  }

  if (index === anchors.length - 1) {
    return normalize(subtract(anchors[index], anchors[index - 1]));
  }

  return normalize(subtract(anchors[index + 1], anchors[index - 1]));
}

function anchorHandleLength(anchors: readonly Vector2[], index: number, closed: boolean): number {
  if (anchors.length < 2) {
    return 0;
  }

  const previousIndex = index - 1;
  const nextIndex = index + 1;
  const previousDistance =
    previousIndex >= 0
      ? distance(anchors[index], anchors[previousIndex])
      : closed
        ? distance(anchors[index], anchors[anchors.length - 1])
        : distance(anchors[index], anchors[nextIndex]);
  const nextDistance =
    nextIndex < anchors.length
      ? distance(anchors[index], anchors[nextIndex])
      : closed
        ? distance(anchors[index], anchors[0])
        : distance(anchors[index], anchors[previousIndex]);

  return Math.min(previousDistance, nextDistance) / 3;
}

function segmentFallback(anchors: readonly Vector2[], index: number, closed: boolean): Vector2 {
  const nextIndex = index + 1 < anchors.length ? index + 1 : closed ? 0 : index;
  const previousIndex = index > 0 ? index - 1 : closed ? anchors.length - 1 : index;
  const forward = subtract(anchors[nextIndex], anchors[index]);
  if (distance(forward, { x: 0, y: 0 }) > 1e-9) {
    return normalize(forward);
  }
  return normalize(subtract(anchors[index], anchors[previousIndex]));
}

function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vector2, scalar: number): Vector2 {
  return { x: v.x * scalar, y: v.y * scalar };
}

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vector2, fallback: Vector2 = { x: 1, y: 0 }): Vector2 {
  const magnitude = Math.hypot(v.x, v.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return fallback;
  }

  return scale(v, 1 / magnitude);
}
