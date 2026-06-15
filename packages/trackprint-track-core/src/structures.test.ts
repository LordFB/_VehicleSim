import { describe, expect, it } from 'vitest';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import { createStationLookup } from './stationing';
import { resolveStructureSpans, validateBridges, validateTunnels } from './structures';
import type { TrackDocument } from './trackDocument';

describe('structure spans', () => {
  it('maps a bridged segment to its station range', () => {
    const base = createDefaultTrackDocument();
    const document: TrackDocument = {
      ...base,
      segments: base.segments.map((segment, index) => (index === 1 ? { ...segment, bridge: true } : segment)),
    };
    const lookup = createStationLookup(document, 32);
    const spans = resolveStructureSpans(document, lookup);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.kind).toBe('bridge');
    expect(span.startStation).toBeCloseTo(lookup.segmentStartStations[1]);
    expect(span.endStation).toBeCloseTo(lookup.segmentStartStations[1] + lookup.segmentLengths[1]);
    // Both sides identical for a bridge.
    expect(span.left).toEqual(span.right);
  });

  it('carries the per-side skew for a tunnel and unions start/end', () => {
    const base = createStraightTrackDocument();
    const document: TrackDocument = {
      ...base,
      tunnels: [
        {
          id: 't1',
          leftStartStation: 5,
          leftEndStation: 30,
          rightStartStation: 10,
          rightEndStation: 35,
          width: 12,
          height: 6,
          materialId: 'concrete',
        },
      ],
    };
    const lookup = createStationLookup(document, 32);
    const [span] = resolveStructureSpans(document, lookup);
    expect(span.kind).toBe('tunnel');
    expect(span.left).toEqual({ start: 5, end: 30 });
    expect(span.right).toEqual({ start: 10, end: 35 });
    expect(span.startStation).toBe(5);
    expect(span.endStation).toBe(35);
  });
});

describe('structure validation', () => {
  it('flags non-positive tunnel dimensions and out-of-range stations', () => {
    const base = createStraightTrackDocument();
    const lookup = createStationLookup(base, 32);
    const document: TrackDocument = {
      ...base,
      tunnels: [
        {
          id: 'bad',
          leftStartStation: -5,
          leftEndStation: 10,
          rightStartStation: 0,
          rightEndStation: lookup.totalLength + 50,
          width: 0,
          height: -1,
          materialId: 'concrete',
        },
      ],
    };
    const issues = validateTunnels(document, lookup);
    expect(issues.some((issue) => issue.severity === 'error' && /width/.test(issue.message))).toBe(true);
    expect(issues.some((issue) => issue.severity === 'error' && /height/.test(issue.message))).toBe(true);
    expect(issues.some((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('detects overlapping tunnels', () => {
    const base = createStraightTrackDocument();
    const lookup = createStationLookup(base, 32);
    const document: TrackDocument = {
      ...base,
      tunnels: [
        { id: 'a', leftStartStation: 0, leftEndStation: 20, rightStartStation: 0, rightEndStation: 20, width: 8, height: 5, materialId: 'c' },
        { id: 'b', leftStartStation: 10, leftEndStation: 30, rightStartStation: 10, rightEndStation: 30, width: 8, height: 5, materialId: 'c' },
      ],
    };
    expect(validateTunnels(document, lookup).some((issue) => /overlap/.test(issue.message))).toBe(true);
  });

  it('warns on a zero-length bridged segment', () => {
    const base = createStraightTrackDocument();
    const degenerate: TrackDocument = {
      ...base,
      segments: [
        {
          id: 'point',
          kind: 'cubicBezier',
          p0: { id: 'a', position: { x: 0, y: 0 } },
          p1: { id: 'b', position: { x: 0, y: 0 } },
          p2: { id: 'c', position: { x: 0, y: 0 } },
          p3: { id: 'd', position: { x: 0, y: 0 } },
          bridge: true,
        },
      ],
    };
    const lookup = createStationLookup(degenerate, 16);
    expect(validateBridges(degenerate, lookup).some((issue) => /zero length/.test(issue.message))).toBe(true);
  });
});
