import type {
  CubicBezierSegmentDocument,
  Segment,
  SegmentSample,
  TrackSegmentDocument,
} from './trackDocument';
import { add, distance, normalize, scale, type Vector2 } from './vector';

export class CubicBezierSegment implements Segment {
  readonly id: string;
  readonly kind = 'cubicBezier';

  constructor(private readonly segment: CubicBezierSegmentDocument) {
    this.id = segment.id;
  }

  evaluate(t: number): Vector2 {
    return evaluateCubicBezier(
      this.segment.p0.position,
      this.segment.p1.position,
      this.segment.p2.position,
      this.segment.p3.position,
      clamp01(t),
    );
  }

  derivative(t: number): Vector2 {
    return evaluateCubicBezierDerivative(
      this.segment.p0.position,
      this.segment.p1.position,
      this.segment.p2.position,
      this.segment.p3.position,
      clamp01(t),
    );
  }

  tangent(t: number): Vector2 {
    return normalize(this.derivative(t));
  }

  length(samples = 32): number {
    const count = Math.max(1, Math.floor(samples));
    let total = 0;
    let previous = this.evaluate(0);

    for (let index = 1; index <= count; index += 1) {
      const point = this.evaluate(index / count);
      total += distance(previous, point);
      previous = point;
    }

    return total;
  }

  sample(count: number): SegmentSample[] {
    const safeCount = Math.max(2, Math.floor(count));
    return Array.from({ length: safeCount }, (_, index) => {
      const t = index / (safeCount - 1);
      return { t, position: this.evaluate(t) };
    });
  }
}

export function createSegment(segment: TrackSegmentDocument): Segment {
  switch (segment.kind) {
    case 'cubicBezier':
      return new CubicBezierSegment(segment);
  }
}

export function evaluateCubicBezier(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  p3: Vector2,
  t: number,
): Vector2 {
  const inverse = 1 - t;
  const a = scale(p0, inverse * inverse * inverse);
  const b = scale(p1, 3 * inverse * inverse * t);
  const c = scale(p2, 3 * inverse * t * t);
  const d = scale(p3, t * t * t);
  return add(add(a, b), add(c, d));
}

export function evaluateCubicBezierDerivative(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  p3: Vector2,
  t: number,
): Vector2 {
  const inverse = 1 - t;
  const a = scale({ x: p1.x - p0.x, y: p1.y - p0.y }, 3 * inverse * inverse);
  const b = scale({ x: p2.x - p1.x, y: p2.y - p1.y }, 6 * inverse * t);
  const c = scale({ x: p3.x - p2.x, y: p3.y - p2.y }, 3 * t * t);
  return add(add(a, b), c);
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }

  return value;
}
