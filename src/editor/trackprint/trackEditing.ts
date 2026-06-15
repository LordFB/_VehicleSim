import {
  repairTrackContinuity,
  type TrackDocument,
  type TrackSegmentDocument,
  type Vector2,
} from '@trackprint/track-core';

type AnchorRole = 'p0' | 'p3';
type HandleRole = 'p1' | 'p2';

interface AnchorOccurrence {
  readonly segmentIndex: number;
  readonly role: AnchorRole;
}

interface HandleOccurrence {
  readonly segmentIndex: number;
  readonly role: HandleRole;
}

interface AnchorGroup {
  readonly id: string;
  readonly occurrences: AnchorOccurrence[];
}

interface TrackTopology {
  readonly anchorGroups: AnchorGroup[];
}

export function moveTrackControlPoint(
  document: TrackDocument,
  pointId: string,
  position: Vector2,
  elevation?: number,
): TrackDocument {
  const topology = buildTrackTopology(document);
  const anchorGroup = topology.anchorGroups.find((group) =>
    group.occurrences.some((occurrence) => anchorAt(document, occurrence).id === pointId),
  );

  if (anchorGroup) {
    return repairTrackContinuity(moveAnchorGroup(document, anchorGroup, pointId, position, elevation));
  }

  const handle = findHandle(document, pointId);
  if (handle) {
    return repairTrackContinuity(moveHandle(document, topology, handle, position, elevation));
  }

  return document;
}

function buildTrackTopology(document: TrackDocument): TrackTopology {
  const groups: AnchorGroup[] = [];
  const consumed = new Set<string>();

  document.segments.forEach((_, index) => {
    for (const role of ['p0', 'p3'] as const) {
      const key = occurrenceKey({ segmentIndex: index, role });
      if (consumed.has(key)) {
        continue;
      }

      const seed = { segmentIndex: index, role };
      const occurrences = collectConnectedAnchors(document, seed);
      occurrences.forEach((occurrence) => consumed.add(occurrenceKey(occurrence)));
      groups.push({
        id: anchorAt(document, seed).id,
        occurrences,
      });
    }
  });

  return { anchorGroups: groups };
}

function collectConnectedAnchors(
  document: TrackDocument,
  seed: AnchorOccurrence,
): AnchorOccurrence[] {
  const queue = [seed];
  const seen = new Set<string>();
  const result: AnchorOccurrence[] = [];

  while (queue.length > 0) {
    const occurrence = queue.shift() as AnchorOccurrence;
    const key = occurrenceKey(occurrence);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(occurrence);
    const anchor = anchorAt(document, occurrence);

    document.segments.forEach((segment, segmentIndex) => {
      if (segment.p0.id === anchor.id) {
        queue.push({ segmentIndex, role: 'p0' });
      }
      if (segment.p3.id === anchor.id) {
        queue.push({ segmentIndex, role: 'p3' });
      }
    });

    const nextByOrder = connectedBySegmentOrder(document, occurrence);
    if (nextByOrder) {
      queue.push(nextByOrder);
    }
  }

  return result.sort((a, b) => a.segmentIndex - b.segmentIndex || a.role.localeCompare(b.role));
}

function connectedBySegmentOrder(
  document: TrackDocument,
  occurrence: AnchorOccurrence,
): AnchorOccurrence | null {
  if (document.segments.length < 2) {
    return null;
  }

  if (occurrence.role === 'p3') {
    const nextIndex = occurrence.segmentIndex + 1;
    if (nextIndex < document.segments.length) {
      return { segmentIndex: nextIndex, role: 'p0' };
    }
    return document.closed ? { segmentIndex: 0, role: 'p0' } : null;
  }

  const previousIndex = occurrence.segmentIndex - 1;
  if (previousIndex >= 0) {
    return { segmentIndex: previousIndex, role: 'p3' };
  }
  return document.closed ? { segmentIndex: document.segments.length - 1, role: 'p3' } : null;
}

function moveAnchorGroup(
  document: TrackDocument,
  anchorGroup: AnchorGroup,
  pointId: string,
  position: Vector2,
  elevation?: number,
): TrackDocument {
  const currentPosition = anchorAt(document, anchorGroup.occurrences[0]).position;
  const pointPosition = findPointPosition(document, pointId) ?? currentPosition;
  const delta = subtract(position, pointPosition);
  const occurrenceKeys = new Set(anchorGroup.occurrences.map(occurrenceKey));
  const adjacentHandleKeys = new Set(
    anchorGroup.occurrences.map(adjacentHandleForAnchor).map(handleOccurrenceKey),
  );

  return {
    ...document,
    segments: document.segments.map((segment, segmentIndex) =>
      rewriteSegment(segment, segmentIndex, {
        anchors: occurrenceKeys,
        anchorPosition: add(currentPosition, delta),
        anchorElevation: elevation,
        translatedHandles: adjacentHandleKeys,
        handleDelta: delta,
      }),
    ),
  };
}

function moveHandle(
  document: TrackDocument,
  topology: TrackTopology,
  handle: HandleOccurrence,
  position: Vector2,
  elevation?: number,
): TrackDocument {
  const anchorOccurrence = anchorForHandle(handle);
  const anchorGroup = topology.anchorGroups.find((group) =>
    group.occurrences.some((occurrence) => occurrenceKey(occurrence) === occurrenceKey(anchorOccurrence)),
  );
  const oppositeHandle = anchorGroup
    ? oppositeHandleForAnchorGroup(document, anchorGroup, handle)
    : null;
  const anchorPosition = anchorAt(document, anchorOccurrence).position;
  const movedDirection = normalize(subtract(position, anchorPosition));
  const oppositePosition =
    oppositeHandle === null
      ? null
      : add(
          anchorPosition,
          scale(movedDirection, -distance(anchorPosition, handleAt(document, oppositeHandle).position)),
        );

  return {
    ...document,
    segments: document.segments.map((segment, segmentIndex) =>
      rewriteSegment(segment, segmentIndex, {
        movedHandle: handle,
        movedHandlePosition: position,
        movedHandleElevation: elevation,
        mirroredHandle: oppositeHandle,
        mirroredHandlePosition: oppositePosition,
      }),
    ),
  };
}

function rewriteSegment(
  segment: TrackSegmentDocument,
  segmentIndex: number,
  edit: {
    readonly anchors?: ReadonlySet<string>;
    readonly anchorPosition?: Vector2;
    readonly anchorElevation?: number;
    readonly translatedHandles?: ReadonlySet<string>;
    readonly handleDelta?: Vector2;
    readonly movedHandle?: HandleOccurrence;
    readonly movedHandlePosition?: Vector2;
    readonly movedHandleElevation?: number;
    readonly mirroredHandle?: HandleOccurrence | null;
    readonly mirroredHandlePosition?: Vector2 | null;
  },
): TrackSegmentDocument {
  const p0Key = occurrenceKey({ segmentIndex, role: 'p0' });
  const p3Key = occurrenceKey({ segmentIndex, role: 'p3' });

  return {
    ...segment,
    p0:
      edit.anchors?.has(p0Key) && edit.anchorPosition
        ? { ...segment.p0, position: edit.anchorPosition, elevation: edit.anchorElevation }
        : segment.p0,
    p1: rewriteHandle(segment.p1, { segmentIndex, role: 'p1' }, edit),
    p2: rewriteHandle(segment.p2, { segmentIndex, role: 'p2' }, edit),
    p3:
      edit.anchors?.has(p3Key) && edit.anchorPosition
        ? { ...segment.p3, position: edit.anchorPosition, elevation: edit.anchorElevation }
        : segment.p3,
  };
}

function rewriteHandle(
  point: TrackSegmentDocument['p1'],
  occurrence: HandleOccurrence,
  edit: Parameters<typeof rewriteSegment>[2],
): TrackSegmentDocument['p1'] {
  const key = handleOccurrenceKey(occurrence);
  if (
    edit.movedHandle &&
    handleOccurrenceKey(edit.movedHandle) === key &&
    edit.movedHandlePosition
  ) {
    return { ...point, position: edit.movedHandlePosition, elevation: edit.movedHandleElevation };
  }

  if (
    edit.mirroredHandle &&
    handleOccurrenceKey(edit.mirroredHandle) === key &&
    edit.mirroredHandlePosition
  ) {
    return { ...point, position: edit.mirroredHandlePosition };
  }

  if (edit.translatedHandles?.has(key) && edit.handleDelta) {
    return { ...point, position: add(point.position, edit.handleDelta) };
  }

  return point;
}

function oppositeHandleForAnchorGroup(
  document: TrackDocument,
  anchorGroup: AnchorGroup,
  movedHandle: HandleOccurrence,
): HandleOccurrence | null {
  const movedAnchor = anchorForHandle(movedHandle);
  for (const anchor of anchorGroup.occurrences) {
    if (occurrenceKey(anchor) === occurrenceKey(movedAnchor)) {
      continue;
    }

    const candidate = adjacentHandleForAnchor(anchor);
    const candidatePoint = handleAt(document, candidate);
    if (candidatePoint.id !== handleAt(document, movedHandle).id) {
      return candidate;
    }
  }

  return null;
}

function anchorForHandle(handle: HandleOccurrence): AnchorOccurrence {
  return {
    segmentIndex: handle.segmentIndex,
    role: handle.role === 'p1' ? 'p0' : 'p3',
  };
}

function adjacentHandleForAnchor(anchor: AnchorOccurrence): HandleOccurrence {
  return {
    segmentIndex: anchor.segmentIndex,
    role: anchor.role === 'p0' ? 'p1' : 'p2',
  };
}

function findHandle(document: TrackDocument, pointId: string): HandleOccurrence | null {
  for (let segmentIndex = 0; segmentIndex < document.segments.length; segmentIndex += 1) {
    const segment = document.segments[segmentIndex];
    if (segment.p1.id === pointId) {
      return { segmentIndex, role: 'p1' };
    }
    if (segment.p2.id === pointId) {
      return { segmentIndex, role: 'p2' };
    }
  }

  return null;
}

function findPointPosition(document: TrackDocument, pointId: string): Vector2 | null {
  for (const segment of document.segments) {
    for (const point of [segment.p0, segment.p1, segment.p2, segment.p3]) {
      if (point.id === pointId) {
        return point.position;
      }
    }
  }

  return null;
}

function anchorAt(document: TrackDocument, occurrence: AnchorOccurrence) {
  const segment = document.segments[occurrence.segmentIndex];
  return occurrence.role === 'p0' ? segment.p0 : segment.p3;
}

function handleAt(document: TrackDocument, occurrence: HandleOccurrence) {
  const segment = document.segments[occurrence.segmentIndex];
  return occurrence.role === 'p1' ? segment.p1 : segment.p2;
}

function occurrenceKey(occurrence: AnchorOccurrence): string {
  return `${occurrence.segmentIndex}:${occurrence.role}`;
}

function handleOccurrenceKey(occurrence: HandleOccurrence): string {
  return `${occurrence.segmentIndex}:${occurrence.role}`;
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

function normalize(v: Vector2): Vector2 {
  const magnitude = Math.hypot(v.x, v.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return { x: 1, y: 0 };
  }
  return scale(v, 1 / magnitude);
}
