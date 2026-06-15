export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export function vec2(x: number, y: number): Vector2 {
  return { x, y };
}

export function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vector2, scalar: number): Vector2 {
  return { x: v.x * scalar, y: v.y * scalar };
}

export function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

export function length(v: Vector2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vector2, b: Vector2): number {
  return length(subtract(a, b));
}

export function normalize(v: Vector2, fallback: Vector2 = { x: 1, y: 0 }): Vector2 {
  const magnitude = length(v);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return fallback;
  }

  return scale(v, 1 / magnitude);
}

export function leftNormal(v: Vector2): Vector2 {
  return normalize({ x: -v.y, y: v.x }, { x: 0, y: 1 });
}

export function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export function isFiniteVector(v: Vector2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

export function normalizeAngleRadians(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}
