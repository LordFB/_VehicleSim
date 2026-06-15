import { describe, expect, it } from 'vitest';
import {
  lonLatToTileXY,
  tileXYToLonLat,
  tileRangeForArea,
  zoomForArea,
} from './tiles';

describe('slippy-map tile math', () => {
  it('matches the canonical OSM wiki example (Berlin-ish at z9)', () => {
    // OSM wiki worked example: lat 52.5, lon 13.4, z9 -> tile (275, 167).
    const tile = lonLatToTileXY(13.4, 52.5, 9);
    expect(tile).toEqual({ x: 275, y: 167, z: 9 });
  });

  it('round-trips a tile corner through lon/lat and back', () => {
    const z = 14;
    const original = { x: 8500, y: 5450 };
    const corner = tileXYToLonLat(original.x, original.y, z);
    const back = lonLatToTileXY(corner.lon, corner.lat, z);
    expect(back.x).toBe(original.x);
    expect(back.y).toBe(original.y);
  });

  it('tile 0/0/0 north-west corner is the world top-left', () => {
    const nw = tileXYToLonLat(0, 0, 0);
    expect(nw.lon).toBeCloseTo(-180, 6);
    expect(nw.lat).toBeCloseTo(85.0511, 3); // Web-Mercator latitude limit.
  });

  it('zoomForArea grows as the area shrinks', () => {
    const wide = zoomForArea(50, 4000);
    const tight = zoomForArea(50, 500);
    expect(tight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThanOrEqual(1);
    expect(tight).toBeLessThanOrEqual(21);
  });

  it('tileRangeForArea produces a bbox centered on the requested point', () => {
    const center = { lat: 50.4372, lon: 5.9714 };
    const { tiles, area } = tileRangeForArea(center, 2000, 15);
    expect(area.north).toBeGreaterThan(area.south);
    expect(area.east).toBeGreaterThan(area.west);
    expect((area.north + area.south) / 2).toBeCloseTo(center.lat, 6);
    expect((area.east + area.west) / 2).toBeCloseTo(center.lon, 6);
    expect(tiles.xMax).toBeGreaterThanOrEqual(tiles.xMin);
    expect(tiles.yMax).toBeGreaterThanOrEqual(tiles.yMin);
  });
});
