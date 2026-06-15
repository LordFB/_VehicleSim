import { describe, expect, it } from 'vitest';
import {
  createGeoAnchor,
  geoToLocalMeters,
  localMetersToGeo,
  metersPerDegLon,
} from './projection';

describe('local tangent-plane projection', () => {
  const center = { lat: 50.4372, lon: 5.9714 }; // Spa-Francorchamps, roughly.
  const anchor = createGeoAnchor(center);

  it('places the center at the local origin', () => {
    const local = geoToLocalMeters(anchor, center);
    expect(local.x).toBeCloseTo(0, 6);
    expect(local.z).toBeCloseTo(0, 6);
  });

  it('round-trips geo -> local -> geo within a few km', () => {
    const points = [
      { lat: center.lat + 0.01, lon: center.lon + 0.01 },
      { lat: center.lat - 0.02, lon: center.lon + 0.015 },
      { lat: center.lat + 0.005, lon: center.lon - 0.03 },
    ];
    for (const point of points) {
      const back = localMetersToGeo(anchor, geoToLocalMeters(anchor, point));
      expect(back.lat).toBeCloseTo(point.lat, 9);
      expect(back.lon).toBeCloseTo(point.lon, 9);
    }
  });

  it('maps higher latitude to smaller z (north is -z)', () => {
    const north = geoToLocalMeters(anchor, { lat: center.lat + 0.01, lon: center.lon });
    expect(north.z).toBeLessThan(0);
  });

  it('maps east to +x and scales longitude by cos(lat)', () => {
    const east = geoToLocalMeters(anchor, { lat: center.lat, lon: center.lon + 0.01 });
    expect(east.x).toBeGreaterThan(0);
    // 0.01 deg lon at this latitude ≈ 111320 * cos(lat) * 0.01 meters.
    expect(east.x).toBeCloseTo(metersPerDegLon(center.lat) * 0.01, 3);
  });

  it('shrinks meters-per-degree-lon toward the poles', () => {
    expect(metersPerDegLon(0)).toBeGreaterThan(metersPerDegLon(60));
    expect(metersPerDegLon(60)).toBeCloseTo(111_320 * 0.5, 0);
  });
});
