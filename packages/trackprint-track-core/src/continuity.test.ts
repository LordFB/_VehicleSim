import { describe, expect, it } from 'vitest';
import { createSegment } from './cubicBezier';
import { repairTrackContinuity } from './continuity';
import { dot, length } from './vector';
import type { TrackDocument } from './trackDocument';

describe('track continuity repair', () => {
  it('repairs mismatched shared endpoint positions', () => {
    const repaired = repairTrackContinuity(createBrokenSharedEndpointDocument());
    expect(repaired.segments[0].p3.position).toEqual(repaired.segments[1].p0.position);
  });

  it('generates smooth handles at ordered segment joins', () => {
    const repaired = repairTrackContinuity(createBrokenSharedEndpointDocument());
    const incoming = createSegment(repaired.segments[0]).tangent(1);
    const outgoing = createSegment(repaired.segments[1]).tangent(0);
    expect(dot(incoming, outgoing)).toBeGreaterThan(0.999);
  });

  it('welds adjacent segment endpoints by ordered topology even when ids differ', () => {
    const document = createBrokenSharedEndpointDocument();
    const repaired = repairTrackContinuity(document);
    expect(repaired.segments[0].p3.position).toEqual(repaired.segments[1].p0.position);
  });

  it('matches derivative magnitude at smooth joins', () => {
    const repaired = repairTrackContinuity(createBrokenSharedEndpointDocument());
    const leftDerivative = {
      x: (repaired.segments[0].p3.position.x - repaired.segments[0].p2.position.x) * 3,
      y: (repaired.segments[0].p3.position.y - repaired.segments[0].p2.position.y) * 3,
    };
    const rightDerivative = {
      x: (repaired.segments[1].p1.position.x - repaired.segments[1].p0.position.x) * 3,
      y: (repaired.segments[1].p1.position.y - repaired.segments[1].p0.position.y) * 3,
    };

    expect(length({ x: leftDerivative.x - rightDerivative.x, y: leftDerivative.y - rightDerivative.y })).toBeLessThan(
      1e-6,
    );
  });
});

function createBrokenSharedEndpointDocument(): TrackDocument {
  return {
    id: 'broken',
    version: 1,
    units: 'meters',
    closed: false,
    segments: [
      {
        id: 'a',
        kind: 'cubicBezier',
        p0: { id: 'p0', position: { x: 0, y: 0 } },
        p1: { id: 'h0', position: { x: 10, y: 0 } },
        p2: { id: 'h1', position: { x: 20, y: 20 } },
        p3: { id: 'join', position: { x: 30, y: 0 } },
      },
      {
        id: 'b',
        kind: 'cubicBezier',
        p0: { id: 'join', position: { x: 34, y: -7 } },
        p1: { id: 'h2', position: { x: 34, y: -26 } },
        p2: { id: 'h3', position: { x: 50, y: 0 } },
        p3: { id: 'p1', position: { x: 60, y: 0 } },
      },
    ],
  };
}
