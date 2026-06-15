import { describe, expect, it } from 'vitest';
import { createSegment, createStationLookup, dot, evaluateStation } from '@trackprint/track-core';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { moveTrackControlPoint } from './trackEditing';

describe('track editing', () => {
  it('moves shared control points and changes compiled geometry', () => {
    const document = createDefaultTrackDocument();
    const moved = moveTrackControlPoint(document, 'p-east', { x: 112, y: 12 });
    const before = createStationLookup(document, 24);
    const after = createStationLookup(moved, 24);

    expect(after.totalLength).not.toBeCloseTo(before.totalLength);
    expect(moved.segments[0].p0.position).toEqual({ x: 112, y: 12 });
    expect(moved.segments[3].p3.position).toEqual({ x: 112, y: 12 });
  });

  it('regenerates adjacent handles when moving a shared anchor', () => {
    const document = createDefaultTrackDocument();
    const moved = moveTrackControlPoint(document, 'p-east', { x: 112, y: 12 });

    expect(moved.segments[0].p1.position).not.toEqual(document.segments[0].p1.position);
    expect(moved.segments[3].p2.position).not.toEqual(document.segments[3].p2.position);
  });

  it('keeps handles generated from anchors when a handle edit is requested', () => {
    const document = createDefaultTrackDocument();
    const moved = moveTrackControlPoint(document, 'h-east-north', { x: 120, y: 40 });

    expect(moved.segments[0].p0.position).toEqual(document.segments[0].p0.position);
    expect(moved.segments[0].p1.position).not.toEqual({ x: 120, y: 40 });
  });

  it('keeps paired segment tangents aligned at a moved shared anchor', () => {
    const moved = moveTrackControlPoint(createDefaultTrackDocument(), 'p-east', {
      x: 112,
      y: 12,
    });
    const outgoing = createSegment(moved.segments[0]).tangent(0);
    const incoming = createSegment(moved.segments[3]).tangent(1);

    expect(dot(outgoing, incoming)).toBeGreaterThan(0.999);
  });

  it('keeps the car on the edited centerline', () => {
    const moved = moveTrackControlPoint(createDefaultTrackDocument(), 'p-east', { x: 112, y: 12 });
    const lookup = createStationLookup(moved, 24);
    const sample = evaluateStation(moved, lookup, lookup.totalLength * 0.25);

    expect(Number.isFinite(sample.position.x)).toBe(true);
    expect(Number.isFinite(sample.position.y)).toBe(true);
    expect(Number.isFinite(sample.tangent.x)).toBe(true);
    expect(Number.isFinite(sample.tangent.y)).toBe(true);
  });

  it('connects anchors by segment order even when shared endpoint ids drift', () => {
    const document = createDefaultTrackDocument();
    const drifted = {
      ...document,
      segments: document.segments.map((segment, index) =>
        index === 1
          ? {
              ...segment,
              p0: { ...segment.p0, id: 'drifted-north' },
            }
          : segment,
      ),
    };

    const moved = moveTrackControlPoint(drifted, 'p-north', { x: 12, y: 106 });
    expect(moved.segments[0].p3.position).toEqual({ x: 12, y: 106 });
    expect(moved.segments[1].p0.position).toEqual({ x: 12, y: 106 });
  });
});
