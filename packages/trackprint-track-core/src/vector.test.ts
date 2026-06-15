import { describe, expect, it } from 'vitest';
import { add, normalizeAngleRadians, vec2 } from './index';

describe('vector utilities', () => {
  it('adds vectors', () => {
    expect(add(vec2(2, 3), vec2(4, -1))).toEqual({ x: 6, y: 2 });
  });

  it('normalizes angles into the signed pi range', () => {
    const angle = normalizeAngleRadians(Math.PI * 3);
    expect(angle).toBeGreaterThanOrEqual(-Math.PI);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });
});
