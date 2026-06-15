// Web-Mercator "slippy map" tile math (XYZ / TMS-style, as used by Esri World
// Imagery, OSM, Mapbox, Google). Standard formulas:
//   https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

import type { GeoAnchor, LatLon } from './projection';

export interface TileXY {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TileRange {
  readonly z: number;
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

export interface LatLonBounds {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

/** Fractional tile coordinate (before flooring) for a lon/lat at a zoom. */
export function lonLatToTileXYFloat(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function lonLatToTileXY(lon: number, lat: number, z: number): TileXY {
  const { x, y } = lonLatToTileXYFloat(lon, lat, z);
  return { x: Math.floor(x), y: Math.floor(y), z };
}

/** Lon/lat of a tile's north-west (top-left) corner. */
export function tileXYToLonLat(x: number, y: number, z: number): LatLon {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (latRad * 180) / Math.PI, lon };
}

/** Esri World Imagery serves up to ~z21 in most populated areas. */
export const MAX_IMAGERY_ZOOM = 21;

// Pick a zoom so the requested ground area fills roughly `targetPixels` of
// imagery. Higher targetPixels → higher zoom → sharper aerial (at the cost of
// more tiles). Web-Mercator ground resolution at the equator is ~156543 m/px at
// z0, halving each zoom; scaled by cos(lat) for the local meridian.
export function zoomForArea(centerLat: number, sizeMeters: number, targetPixels = 2048): number {
  const metersPerPixelAtZ0 = 156_543.03 * Math.cos((centerLat * Math.PI) / 180);
  const desiredMetersPerPixel = sizeMeters / targetPixels;
  const z = Math.log2(metersPerPixelAtZ0 / desiredMetersPerPixel);
  return Math.max(1, Math.min(MAX_IMAGERY_ZOOM, Math.round(z)));
}

// Tile range + exact lon/lat bbox covering a square area centered on `center`.
// The bbox is the precise area we want; the tile range is the (slightly larger)
// set of 256px tiles that must be fetched and then cropped to the bbox.
export function tileRangeForArea(
  center: LatLon,
  sizeMeters: number,
  z: number,
): { readonly tiles: TileRange; readonly area: LatLonBounds } {
  const anchor: GeoAnchor = {
    centerLat: center.lat,
    centerLon: center.lon,
    metersPerDegLat: 111_320,
    metersPerDegLon: 111_320 * Math.cos((center.lat * Math.PI) / 180),
  };
  const half = sizeMeters / 2;
  // The four extents of the square area, in degrees.
  const north = center.lat + half / anchor.metersPerDegLat;
  const south = center.lat - half / anchor.metersPerDegLat;
  const east = center.lon + half / anchor.metersPerDegLon;
  const west = center.lon - half / anchor.metersPerDegLon;

  const nw = lonLatToTileXY(west, north, z);
  const se = lonLatToTileXY(east, south, z);
  return {
    tiles: {
      z,
      xMin: Math.min(nw.x, se.x),
      xMax: Math.max(nw.x, se.x),
      yMin: Math.min(nw.y, se.y),
      yMax: Math.max(nw.y, se.y),
    },
    area: { north, south, east, west },
  };
}
