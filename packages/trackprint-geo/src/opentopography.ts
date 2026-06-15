// OpenTopography Global DEM — a *raster* elevation source (one request returns a
// GeoTIFF/ASCII grid covering a bounding box), unlike the point-list providers.
// We request the keyless-free AAIGrid (Esri/GDAL ASCII grid) format so no binary
// GeoTIFF decoder is needed, parse it, and bilinearly resample onto our grid.
//
// Requires a free API key: https://portal.opentopography.org (My Account).
// API: https://portal.opentopography.org/API/globaldem?demtype=…&south=…&north=…
//      &west=…&east=…&outputFormat=AAIGrid&API_Key=…

import type { LatLon } from './projection';
import { createGeoAnchor, localMetersToGeo } from './projection';
import type { HeightGrid } from './elevation';

export interface OpenTopographyOptions {
  readonly apiKey: string;
  /** DEM dataset; default SRTMGL1 (30 m). COP30/NASADEM/AW3D30 also valid. */
  readonly demType?: string;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly onProgress?: (fraction: number) => void;
}

export interface ParsedAsciiGrid {
  readonly ncols: number;
  readonly nrows: number;
  readonly xllcorner: number;
  readonly yllcorner: number;
  readonly cellsize: number;
  readonly nodata: number;
  /** Row-major, row 0 = north (top), west→east within a row. */
  readonly values: number[];
}

// Parse an Esri/GDAL Arc/Info ASCII Grid. Header lines are
// `key value` pairs (ncols/nrows/xllcorner/yllcorner/cellsize/NODATA_value),
// followed by nrows rows of ncols whitespace-separated numbers, north→south.
export function parseAsciiGrid(text: string): ParsedAsciiGrid {
  const tokens = text.trim().split(/\s+/);
  const header: Record<string, number> = {};
  let i = 0;
  // The header has 5–6 key/value pairs; keys are non-numeric tokens.
  while (i + 1 < tokens.length && Number.isNaN(Number(tokens[i]))) {
    header[tokens[i].toLowerCase()] = Number(tokens[i + 1]);
    i += 2;
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  if (!Number.isFinite(ncols) || !Number.isFinite(nrows)) {
    throw new Error('AAIGrid response missing ncols/nrows header.');
  }
  const nodata = header.nodata_value ?? -9999;
  const values = new Array<number>(ncols * nrows);
  for (let v = 0; v < ncols * nrows; v += 1) {
    values[v] = Number(tokens[i + v]);
  }
  return {
    ncols,
    nrows,
    xllcorner: header.xllcorner ?? 0,
    yllcorner: header.yllcorner ?? 0,
    cellsize: header.cellsize ?? 0,
    nodata,
    values,
  };
}

// Bilinearly sample the parsed raster at a lon/lat. The grid's cell (0,0) is the
// south-west corner (xllcorner,yllcorner); row 0 of `values` is the NORTH edge.
function sampleAscii(grid: ParsedAsciiGrid, lon: number, lat: number): number {
  const fx = (lon - grid.xllcorner) / grid.cellsize;
  // yll is the south edge; flip because row 0 is north.
  const fyFromSouth = (lat - grid.yllcorner) / grid.cellsize;
  const fy = grid.nrows - 1 - fyFromSouth;
  const x0 = Math.max(0, Math.min(grid.ncols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(grid.nrows - 1, Math.floor(fy)));
  const x1 = Math.min(grid.ncols - 1, x0 + 1);
  const y1 = Math.min(grid.nrows - 1, y0 + 1);
  const tx = Math.min(Math.max(fx - x0, 0), 1);
  const ty = Math.min(Math.max(fy - y0, 0), 1);
  const at = (cx: number, cy: number) => {
    const value = grid.values[cy * grid.ncols + cx];
    return value === grid.nodata ? 0 : value;
  };
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

// Fetch one AAIGrid covering the square area and resample it to columns×rows in
// the same row-major (north-first) order the terrain document expects.
export async function fetchHeightGridFromOpenTopography(
  center: LatLon,
  sizeMeters: number,
  columns: number,
  rows: number,
  options: OpenTopographyOptions,
): Promise<HeightGrid> {
  const doFetch = options.fetchImpl ?? fetch;
  const demType = options.demType ?? 'SRTMGL1';
  const anchor = createGeoAnchor(center);
  const half = sizeMeters / 2;
  // Bounding box from the area extents (pad slightly so edge samples interpolate
  // cleanly rather than clamp).
  const pad = sizeMeters * 0.02;
  const north = center.lat + (half + pad) / anchor.metersPerDegLat;
  const south = center.lat - (half + pad) / anchor.metersPerDegLat;
  const east = center.lon + (half + pad) / anchor.metersPerDegLon;
  const west = center.lon - (half + pad) / anchor.metersPerDegLon;

  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=${encodeURIComponent(demType)}` +
    `&south=${south}&north=${north}&west=${west}&east=${east}` +
    `&outputFormat=AAIGrid&API_Key=${encodeURIComponent(options.apiKey)}`;

  options.onProgress?.(0.1);
  const response = await doFetch(url, { signal: options.signal });
  if (!response.ok) {
    const hint =
      response.status === 401
        ? ' Check your OpenTopography API key.'
        : response.status === 429
          ? ' OpenTopography is rate-limiting — wait a moment or try a smaller area.'
          : '';
    throw new Error(
      `OpenTopography request failed (${response.status} ${response.statusText}).${hint}`,
    );
  }
  const text = await response.text();
  options.onProgress?.(0.6);
  const grid = parseAsciiGrid(text);

  const xStep = columns > 1 ? sizeMeters / (columns - 1) : 0;
  const zStep = rows > 1 ? sizeMeters / (rows - 1) : 0;
  const raw = new Array<number>(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    const z = -half + row * zStep; // north (row 0) = -half
    for (let col = 0; col < columns; col += 1) {
      const x = -half + col * xStep;
      const { lat, lon } = localMetersToGeo(anchor, { x, z });
      raw[row * columns + col] = sampleAscii(grid, lon, lat);
    }
  }
  options.onProgress?.(1);

  const baseElevation = raw.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const base = Number.isFinite(baseElevation) ? baseElevation : 0;
  return { heights: raw.map((value) => value - base), columns, rows, baseElevation: base };
}
