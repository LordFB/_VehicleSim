import type { Vector2 } from './vector';
import type { TrackValidationIssue, WallInterval } from './trackDocument';

// One resolved barrier box along a wall: a world position, the yaw aligning it
// with the local path direction, and the half-length it spans. The exporter
// turns each into a sim BarrierSpec; the viewport draws a matching box. Keeping
// resolution in one place means the preview and the exported collision geometry
// can never drift apart.
export interface WallSegmentResolved {
  readonly position: Vector2;
  readonly yawRad: number;
  readonly halfLength: number;
  readonly height: number;
}

/**
 * Resolve a free-drawn wall into a run of short oriented barrier boxes laid
 * along its polyline. With `cornerMode: 'smooth'` each interior corner is first
 * rounded by a fillet arc of `cornerRadius`, so the run curves through turns
 * instead of kinking. The densified centerline is then walked at `segmentLength`
 * spacing, emitting one box per step. Returns an empty array for a degenerate
 * wall (fewer than two points, or zero total length).
 */
export function resolveWallSegments(wall: WallInterval): WallSegmentResolved[] {
  const path = wall.cornerMode === 'smooth' ? filletCorners(wall.points, wall.cornerRadius) : [...wall.points];
  const polyline = dedupe(path);
  if (polyline.length < 2) {
    return [];
  }
  const step = Math.max(0.5, wall.segmentLength);
  const out: WallSegmentResolved[] = [];
  // Walk the polyline at a fixed arc-length cadence, carrying leftover distance
  // across vertices so segments don't reset at every corner.
  let carry = step * 0.5; // place the first box centered half a step in
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segDx = b.x - a.x;
    const segDz = b.y - a.y;
    const segLength = Math.hypot(segDx, segDz);
    if (segLength <= 1e-6) {
      continue;
    }
    const ux = segDx / segLength;
    const uz = segDz / segLength;
    const yawRad = Math.atan2(segDx, segDz);
    let dist = carry;
    while (dist <= segLength) {
      out.push({
        position: { x: a.x + ux * dist, y: a.y + uz * dist },
        yawRad,
        halfLength: step * 0.5,
        height: wall.height,
      });
      dist += step;
    }
    carry = dist - segLength;
  }
  return out;
}

// Round every interior corner of a polyline with a fillet arc of `radius`,
// trimming each adjacent leg by up to that radius and inserting a short arc.
// Endpoints are preserved. A radius of 0 (or a corner too tight for it) leaves
// that joint sharp.
function filletCorners(points: readonly Vector2[], radius: number): Vector2[] {
  if (points.length < 3 || radius <= 1e-3) {
    return [...points];
  }
  const out: Vector2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLen = distance(prev, corner);
    const outLen = distance(corner, next);
    const trim = Math.min(radius, inLen * 0.5, outLen * 0.5);
    if (trim <= 1e-3) {
      out.push(corner);
      continue;
    }
    const inDir = unit(sub(prev, corner));
    const outDir = unit(sub(next, corner));
    const start = { x: corner.x + inDir.x * trim, y: corner.y + inDir.y * trim };
    const end = { x: corner.x + outDir.x * trim, y: corner.y + outDir.y * trim };
    // Approximate the rounded corner with a few chords between the trim points.
    const arcSteps = 6;
    out.push(start);
    for (let s = 1; s < arcSteps; s += 1) {
      const t = s / arcSteps;
      // Quadratic Bezier with the corner as the control point gives a clean
      // fillet between the two trimmed leg ends.
      const mt = 1 - t;
      out.push({
        x: mt * mt * start.x + 2 * mt * t * corner.x + t * t * end.x,
        y: mt * mt * start.y + 2 * mt * t * corner.y + t * t * end.y,
      });
    }
    out.push(end);
  }
  out.push(points[points.length - 1]);
  return out;
}

function dedupe(points: readonly Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, point) > 1e-4) {
      out.push(point);
    }
  }
  return out;
}

function sub(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v: Vector2): Vector2 {
  const length = Math.hypot(v.x, v.y);
  if (length <= 1e-9) {
    return { x: 1, y: 0 };
  }
  return { x: v.x / length, y: v.y / length };
}

function distance(a: Vector2, b: Vector2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Validate authored walls: errors for non-physical values, a warning for a
 * wall that won't appear (fewer than two distinct points).
 */
export function validateWalls(walls: readonly WallInterval[] | undefined): TrackValidationIssue[] {
  const issues: TrackValidationIssue[] = [];
  for (const wall of walls ?? []) {
    if (!(wall.height > 0)) {
      issues.push({ severity: 'error', message: `Wall ${wall.id} height must be positive.` });
    }
    if (!(wall.segmentLength > 0)) {
      issues.push({ severity: 'error', message: `Wall ${wall.id} segment length must be positive.` });
    }
    if (dedupe(wall.points).length < 2) {
      issues.push({
        severity: 'warning',
        message: `Wall ${wall.id} needs at least two points and will not appear.`,
      });
    }
    if (wall.cornerMode === 'smooth' && wall.cornerRadius < 0) {
      issues.push({ severity: 'error', message: `Wall ${wall.id} corner radius cannot be negative.` });
    }
  }
  return issues;
}
