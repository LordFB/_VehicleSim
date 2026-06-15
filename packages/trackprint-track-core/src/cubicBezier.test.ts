import { describe, expect, it } from 'vitest';
import { CubicBezierSegment, isFiniteVector } from './index';

const segment = new CubicBezierSegment({
  id: 'test',
  kind: 'cubicBezier',
  p0: { id: 'p0', position: { x: 0, y: 0 } },
  p1: { id: 'p1', position: { x: 10, y: 0 } },
  p2: { id: 'p2', position: { x: 20, y: 10 } },
  p3: { id: 'p3', position: { x: 30, y: 10 } },
});

describe('CubicBezierSegment', () => {
  it('returns p0 at t=0', () => {
    expect(segment.evaluate(0)).toEqual({ x: 0, y: 0 });
  });

  it('returns p3 at t=1', () => {
    expect(segment.evaluate(1)).toEqual({ x: 30, y: 10 });
  });

  it('returns finite tangents', () => {
    expect(isFiniteVector(segment.tangent(0.5))).toBe(true);
  });

  it('has positive approximate length', () => {
    expect(segment.length()).toBeGreaterThan(0);
  });
});
