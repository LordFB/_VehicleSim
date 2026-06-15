import { describe, expect, it, vi } from 'vitest';
import { fetchHeightGridFromOpenTopography, parseAsciiGrid } from './opentopography';

describe('AAIGrid parsing', () => {
  const aai = [
    'ncols 3',
    'nrows 2',
    'xllcorner 5.0',
    'yllcorner 50.0',
    'cellsize 0.5',
    'NODATA_value -9999',
    '11 12 13', // north row
    '21 22 23', // south row
  ].join('\n');

  it('parses header and row-major values (row 0 = north)', () => {
    const grid = parseAsciiGrid(aai);
    expect(grid.ncols).toBe(3);
    expect(grid.nrows).toBe(2);
    expect(grid.cellsize).toBe(0.5);
    expect(grid.nodata).toBe(-9999);
    expect(grid.values).toEqual([11, 12, 13, 21, 22, 23]);
  });

  it('throws on a malformed header', () => {
    expect(() => parseAsciiGrid('garbage 1 2 3')).toThrow(/ncols\/nrows/);
  });
});

describe('OpenTopography fetch', () => {
  it('fetches AAIGrid and resamples to the requested grid', async () => {
    const aai = [
      'ncols 4',
      'nrows 4',
      'xllcorner 5.90',
      'yllcorner 50.40',
      'cellsize 0.02',
      'NODATA_value -9999',
      '40 41 42 43',
      '30 31 32 33',
      '20 21 22 23',
      '10 11 12 13',
    ].join('\n');
    let requestedUrl = '';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => aai,
      } as Response;
    });

    const grid = await fetchHeightGridFromOpenTopography(
      { lat: 50.43, lon: 5.93 },
      400,
      3,
      3,
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(grid.heights).toHaveLength(9);
    expect(Math.min(...grid.heights)).toBe(0);
    // The request carries the key and AAIGrid format.
    expect(requestedUrl).toContain('API_Key=k');
    expect(requestedUrl).toContain('outputFormat=AAIGrid');
  });

  it('surfaces a helpful message on a bad key (401)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '',
    } as Response));

    await expect(
      fetchHeightGridFromOpenTopography({ lat: 50, lon: 6 }, 400, 2, 2, {
        apiKey: 'bad',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/API key/);
  });
});
