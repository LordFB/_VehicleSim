// Browser-only: fetch a height grid for a square area by querying an elevation
// provider at each grid sample's lat/lon, batching to respect provider limits.
// Returns a row-major heights[] matching a TerrainResolution (row 0 = north),
// the same ordering terrain-core's heights[row * columns + column] expects.

import type { LatLon } from './projection';
import { createGeoAnchor, localMetersToGeo } from './projection';
import {
  ELEVATION_BATCH_LIMITS,
  ELEVATION_FALLBACKS,
  OPEN_METEO_BATCH_LIMIT,
  type ElevationProvider,
} from './providers';
import { fetchHeightGridFromOpenTopography } from './opentopography';

export interface HeightGrid {
  /** Row-major, length = columns * rows, row 0 = north edge. */
  readonly heights: number[];
  readonly columns: number;
  readonly rows: number;
  /** Lowest raw elevation (meters) — subtracted from heights so min ≈ 0. */
  readonly baseElevation: number;
}

export interface FetchHeightGridOptions {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  /** Override batch size (defaults to the Open-Meteo limit). */
  readonly batchSize?: number;
  /** Injectable fetch for testing; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

// Build the lat/lon for every grid sample. The grid spans `sizeMeters` square,
// centered on `center`, with the same cell layout as the terrain document: x
// runs west→east across columns, z runs north→south down rows.
export function buildSampleGrid(
  center: LatLon,
  sizeMeters: number,
  columns: number,
  rows: number,
): LatLon[] {
  // Coerce defensively: callers sometimes pass values straight from a <select>
  // or <input> (strings). A string loop bound (`row < "65"`) silently
  // mis-iterates, so normalize to integers up front.
  const cols = Math.trunc(Number(columns));
  const rowCount = Math.trunc(Number(rows));
  const anchor = createGeoAnchor(center);
  const half = sizeMeters / 2;
  const xStep = cols > 1 ? sizeMeters / (cols - 1) : 0;
  const zStep = rowCount > 1 ? sizeMeters / (rowCount - 1) : 0;
  const samples: LatLon[] = [];
  for (let row = 0; row < rows; row += 1) {
    // row 0 = north (top); local z is south-positive, so north is -half.
    const z = -half + row * zStep;
    for (let column = 0; column < columns; column += 1) {
      const x = -half + column * xStep;
      samples.push(localMetersToGeo(anchor, { x, z }));
    }
  }
  return samples;
}

export async function fetchHeightGrid(
  provider: ElevationProvider,
  center: LatLon,
  sizeMeters: number,
  columns: number,
  rows: number,
  options: FetchHeightGridOptions = {},
): Promise<HeightGrid> {
  const samples = buildSampleGrid(center, sizeMeters, columns, rows);
  const batchSize = Math.max(1, options.batchSize ?? OPEN_METEO_BATCH_LIMIT);
  const doFetch = options.fetchImpl ?? fetch;

  const raw: number[] = new Array(samples.length);
  let done = 0;
  for (let start = 0; start < samples.length; start += batchSize) {
    const batch = samples.slice(start, start + batchSize);
    const request = provider.buildRequest(batch);
    const response = await fetchWithRetry(
      doFetch,
      request.url,
      {
        method: request.body ? 'POST' : 'GET',
        body: request.body,
        headers: request.headers,
        signal: options.signal,
      },
      options.signal,
    );
    if (!response.ok) {
      const hint =
        response.status === 429
          ? ' The elevation service is rate-limiting requests — wait a moment, or try a smaller resolution/area.'
          : '';
      throw new Error(
        `Elevation request failed (${response.status} ${response.statusText}).${hint}`,
      );
    }
    const json = await response.json();
    const elevations = provider.parseResponse(json);
    if (elevations.length !== batch.length) {
      throw new Error(
        `Elevation response size mismatch: expected ${batch.length}, got ${elevations.length}.`,
      );
    }
    for (let i = 0; i < elevations.length; i += 1) {
      raw[start + i] = elevations[i];
    }
    done += batch.length;
    options.onProgress?.(done / samples.length);
  }

  // Normalize so the lowest point sits near 0 — keeps imported terrain in the
  // same height range the camera/scale already assume, while preserving relief.
  const baseElevation = raw.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const base = Number.isFinite(baseElevation) ? baseElevation : 0;
  const heights = raw.map((value) => value - base);

  return { heights, columns, rows, baseElevation: base };
}

/** Identifies whichever source produced the grid, for status reporting. */
export interface ElevationSource {
  readonly id: string;
  readonly label: string;
}

export interface FetchHeightGridFallbackOptions extends FetchHeightGridOptions {
  /** Ordered point providers to try; defaults to ELEVATION_FALLBACKS. */
  readonly providers?: readonly ElevationProvider[];
  /**
   * OpenTopography API key. When set, OpenTopography's raster DEM is tried
   * FIRST (one request, best quality) before the keyless point providers.
   */
  readonly openTopographyKey?: string;
  /** OpenTopography DEM dataset (default SRTMGL1). */
  readonly openTopographyDemType?: string;
  /** Notified when a source is attempted (in order). */
  readonly onProviderChange?: (source: ElevationSource, attempt: number) => void;
}

// Try several elevation sources in order until one returns a full grid. When an
// OpenTopography key is supplied it goes first (single raster request, highest
// quality); otherwise / on failure we fall through the keyless point providers,
// which rate-limit (429) or go offline. Throws an aggregated error only if every
// source fails.
export async function fetchHeightGridWithFallback(
  center: LatLon,
  sizeMeters: number,
  columns: number,
  rows: number,
  options: FetchHeightGridFallbackOptions = {},
): Promise<HeightGrid & { readonly source: ElevationSource }> {
  const failures: string[] = [];
  let attempt = 0;

  const onAbort = (error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError';

  // 1. OpenTopography raster (keyed), if a key is available.
  if (options.openTopographyKey?.trim()) {
    const source: ElevationSource = { id: 'opentopography', label: 'OpenTopography (SRTM/COP DEM)' };
    options.onProviderChange?.(source, attempt);
    attempt += 1;
    try {
      const grid = await fetchHeightGridFromOpenTopography(center, sizeMeters, columns, rows, {
        apiKey: options.openTopographyKey,
        demType: options.openTopographyDemType,
        signal: options.signal,
        fetchImpl: options.fetchImpl,
        onProgress: options.onProgress,
      });
      return { ...grid, source };
    } catch (error) {
      if (onAbort(error)) throw error;
      failures.push(`${source.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2. Keyless point providers, in order.
  const providers = options.providers ?? ELEVATION_FALLBACKS;
  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    options.onProviderChange?.(provider, attempt);
    attempt += 1;
    try {
      const grid = await fetchHeightGrid(provider, center, sizeMeters, columns, rows, {
        ...options,
        batchSize: options.batchSize ?? ELEVATION_BATCH_LIMITS[provider.id],
      });
      return { ...grid, source: { id: provider.id, label: provider.label } };
    } catch (error) {
      if (onAbort(error)) throw error;
      failures.push(`${provider.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All elevation sources failed. Tried ${attempt}:\n${failures.join('\n')}`);
}

// Retry transient throttling/availability responses (429/503) with exponential
// backoff, honoring a Retry-After header when present. Public elevation APIs
// (e.g. Open-Meteo) rate-limit bursts, so a high-resolution grid split into
// several batches can trip a 429 partway through; a few backed-off retries
// usually clears it without failing the whole import.
async function fetchWithRetry(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  maxRetries = 3,
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await doFetch(url, init);
    if (response.status !== 429 && response.status !== 503) {
      return response;
    }
    if (attempt >= maxRetries) {
      return response;
    }
    const retryAfter = parseRetryAfterMs(response.headers?.get?.('retry-after'));
    const backoff = retryAfter ?? 500 * 2 ** attempt;
    await delay(backoff, signal);
    attempt += 1;
  }
}

function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
