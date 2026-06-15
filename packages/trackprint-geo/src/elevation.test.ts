import { describe, expect, it, vi } from 'vitest';
import { buildSampleGrid, fetchHeightGrid, fetchHeightGridWithFallback } from './elevation';
import {
  OPEN_ELEVATION,
  OPEN_METEO_ELEVATION,
  OPEN_TOPO_DATA_SRTM,
} from './providers';

describe('elevation height grid', () => {
  const center = { lat: 50.4372, lon: 5.9714 };

  it('builds a row-major grid with row 0 to the north', () => {
    const samples = buildSampleGrid(center, 1000, 3, 3);
    expect(samples).toHaveLength(9);
    // First row (north) latitudes should be greater than the last row (south).
    const firstRowLat = samples[0].lat;
    const lastRowLat = samples[6].lat;
    expect(firstRowLat).toBeGreaterThan(lastRowLat);
    // Within a row, longitude increases west -> east.
    expect(samples[1].lon).toBeGreaterThan(samples[0].lon);
    // Center sample (index 4 of 3x3) is the requested center.
    expect(samples[4].lat).toBeCloseTo(center.lat, 9);
    expect(samples[4].lon).toBeCloseTo(center.lon, 9);
  });

  it('normalizes heights so the minimum sits at zero', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      // 2x2 grid -> 4 points; return raw elevations with min 100.
      void url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ elevation: [100, 110, 130, 100] }),
      } as Response;
    });

    const grid = await fetchHeightGrid(OPEN_METEO_ELEVATION, center, 500, 2, 2, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(grid.baseElevation).toBe(100);
    expect(grid.heights).toEqual([0, 10, 30, 0]);
    expect(grid.columns).toBe(2);
    expect(grid.rows).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('batches requests that exceed the provider limit', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      // First batch of 100, then remaining 44 (12x12 = 144 points).
      const size = call === 1 ? 100 : 44;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ elevation: new Array(size).fill(5) }),
      } as Response;
    });

    const grid = await fetchHeightGrid(OPEN_METEO_ELEVATION, center, 1000, 12, 12, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(grid.heights).toHaveLength(144);
  });

  it('throws when the response size does not match the batch', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ elevation: [1, 2] }),
    } as Response));

    await expect(
      fetchHeightGrid(OPEN_METEO_ELEVATION, center, 500, 2, 2, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/size mismatch/);
  });

  it('retries on HTTP 429 then succeeds', async () => {
    // Throttle the first response, succeed thereafter. Retry-After: 0 keeps the
    // backoff instant so the test stays fast.
    const rateLimited = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => '0' },
      json: async () => ({}),
    } as unknown as Response;
    const success = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ elevation: [1, 2, 3, 4] }),
    } as Response;
    const queue: Response[] = [rateLimited, success];
    const fetchImpl = vi.fn(async () => queue.shift() ?? success);

    const grid = await fetchHeightGrid(OPEN_METEO_ELEVATION, center, 500, 2, 2, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // One throttled attempt + one successful retry for the single 4-point batch.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(grid.heights).toHaveLength(4);
  });

  it('gives a rate-limit hint when 429 persists past retries', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => '0' },
      json: async () => ({}),
    } as unknown as Response));

    await expect(
      fetchHeightGrid(OPEN_METEO_ELEVATION, center, 500, 2, 2, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/rate-limiting/);
  });
});

describe('elevation provider fallback', () => {
  const center = { lat: 50.4372, lon: 5.9714 };

  it('falls back to the next provider when the first keeps failing', async () => {
    // Open-Meteo (primary) always 429s past retries; OpenTopoData succeeds.
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('open-meteo.com')) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: { get: () => '0' },
          json: async () => ({}),
        } as unknown as Response;
      }
      // OpenTopoData shape: { results: [{ elevation }] }.
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ results: [{ elevation: 7 }, { elevation: 8 }, { elevation: 9 }, { elevation: 10 }] }),
      } as Response;
    });

    const changes: string[] = [];
    const result = await fetchHeightGridWithFallback(center, 500, 2, 2, {
      providers: [OPEN_METEO_ELEVATION, OPEN_TOPO_DATA_SRTM, OPEN_ELEVATION],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProviderChange: (source) => changes.push(source.id),
    });

    expect(result.source.id).toBe('opentopodata-srtm');
    expect(result.heights).toHaveLength(4);
    expect(changes).toEqual(['open-meteo', 'opentopodata-srtm']);
  });

  it('uses OpenTopography first when an API key is provided', async () => {
    // Minimal AAIGrid: 2x2, cellsize chosen so the area maps inside it.
    const aai = [
      'ncols 2',
      'nrows 2',
      'xllcorner 5.96',
      'yllcorner 50.43',
      'cellsize 0.02',
      'NODATA_value -9999',
      '10 20',
      '30 40',
    ].join('\n');
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('opentopography.org')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => aai } as Response;
      }
      throw new Error('point provider should not be called when OT succeeds');
    });

    const result = await fetchHeightGridWithFallback(center, 500, 3, 3, {
      openTopographyKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.source.id).toBe('opentopography');
    expect(result.heights).toHaveLength(9);
    // Lowest sampled point normalized to 0.
    expect(Math.min(...result.heights)).toBe(0);
  });

  it('falls back from OpenTopography to keyless providers on key failure', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('opentopography.org')) {
        return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ elevation: [1, 2, 3, 4] }),
      } as Response;
    });

    const result = await fetchHeightGridWithFallback(center, 500, 2, 2, {
      openTopographyKey: 'bad-key',
      providers: [OPEN_METEO_ELEVATION],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.source.id).toBe('open-meteo');
    expect(result.heights).toHaveLength(4);
  });

  it('throws an aggregated error when every provider fails', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: { get: () => '0' },
      json: async () => ({}),
    } as unknown as Response));

    await expect(
      fetchHeightGridWithFallback(center, 500, 2, 2, {
        providers: [OPEN_METEO_ELEVATION, OPEN_TOPO_DATA_SRTM, OPEN_ELEVATION],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/All elevation sources failed\. Tried 3/);
  });
});
