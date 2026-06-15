// Local tangent-plane projection.
//
// For a single circuit-sized area (a few km across) we don't need a full
// geodetic CRS / proj4. We anchor on a center lat/lon and approximate the
// ground as flat, converting degrees to meters with a constant scale derived
// at the center latitude. Error is well under 0.1% over a few kilometers,
// which is far below the ~30 m resolution of the elevation source.

export interface LatLon {
  /** Degrees north, WGS84. */
  readonly lat: number;
  /** Degrees east, WGS84. */
  readonly lon: number;
}

/** Local world-space point, meters. x = east, z = south (matches terrain XZ). */
export interface LocalPoint {
  readonly x: number;
  readonly z: number;
}

export interface GeoAnchor {
  readonly centerLat: number;
  readonly centerLon: number;
  /** Meters per degree of latitude at the center (≈ constant). */
  readonly metersPerDegLat: number;
  /** Meters per degree of longitude at the center latitude. */
  readonly metersPerDegLon: number;
}

const METERS_PER_DEG_LAT = 111_320;

export function metersPerDegLon(centerLat: number): number {
  return METERS_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
}

export function createGeoAnchor(center: LatLon): GeoAnchor {
  return {
    centerLat: center.lat,
    centerLon: center.lon,
    metersPerDegLat: METERS_PER_DEG_LAT,
    metersPerDegLon: metersPerDegLon(center.lat),
  };
}

// Convert a geographic point to local meters relative to the anchor center.
//
// World axes are chosen to match the terrain document's XZ (x east, z south)
// and to line up with how slippy-map imagery is drawn: tile rows increase
// southward (decreasing latitude), so a higher latitude maps to a smaller z.
export function geoToLocalMeters(anchor: GeoAnchor, point: LatLon): LocalPoint {
  return {
    x: (point.lon - anchor.centerLon) * anchor.metersPerDegLon,
    z: -(point.lat - anchor.centerLat) * anchor.metersPerDegLat,
  };
}

export function localMetersToGeo(anchor: GeoAnchor, point: LocalPoint): LatLon {
  return {
    lat: anchor.centerLat - point.z / anchor.metersPerDegLat,
    lon: anchor.centerLon + point.x / anchor.metersPerDegLon,
  };
}
