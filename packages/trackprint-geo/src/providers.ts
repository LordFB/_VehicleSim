// Provider config. URL templates keep the imagery/elevation sources swappable
// without touching the fetch/stitch logic. Defaults are free + keyless so the
// feature works out of the box; a keyed provider (e.g. Mapbox) is a config swap.

export interface ImageryProvider {
  readonly id: string;
  readonly label: string;
  /** XYZ tile URL template with {z}/{x}/{y} placeholders. */
  readonly urlTemplate: string;
  /** Pixel size of each tile (almost always 256). */
  readonly tileSize: number;
  /** Optional attribution string to surface in the UI. */
  readonly attribution?: string;
  /** Optional API key/token substituted for {key} in the template. */
  readonly apiKey?: string;
}

export interface ElevationProvider {
  readonly id: string;
  readonly label: string;
  /**
   * Builds a request for a batch of sample points. Returns the URL and an
   * optional POST body; if `body` is set the caller uses POST, else GET.
   */
  readonly buildRequest: (points: readonly { lat: number; lon: number }[]) => {
    readonly url: string;
    readonly body?: string;
    readonly headers?: Record<string, string>;
  };
  /** Extracts elevations (meters, same order as input) from the JSON response. */
  readonly parseResponse: (json: unknown) => number[];
}

// Esri World Imagery — free, no key, global, good resolution.
// Note: ArcGIS uses {z}/{y}/{x} order (row before column).
export const ESRI_WORLD_IMAGERY: ImageryProvider = {
  id: 'esri-world-imagery',
  label: 'Esri World Imagery',
  urlTemplate:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  tileSize: 256,
  attribution: 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

// Open-Meteo elevation API — free, no key, batch GET of comma-joined coords.
// https://open-meteo.com/en/docs/elevation-api  (returns SRTM-derived ~90m;
// fine for circuit-scale relief). Limited to 100 points per request.
export const OPEN_METEO_ELEVATION: ElevationProvider = {
  id: 'open-meteo',
  label: 'Open-Meteo Elevation (SRTM)',
  buildRequest: (points) => {
    const lats = points.map((p) => p.lat.toFixed(6)).join(',');
    const lons = points.map((p) => p.lon.toFixed(6)).join(',');
    return {
      url: `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,
    };
  },
  parseResponse: (json) => {
    const elevation = (json as { elevation?: unknown }).elevation;
    if (!Array.isArray(elevation)) {
      throw new Error('Elevation response missing "elevation" array.');
    }
    return elevation.map((value) => (typeof value === 'number' ? value : 0));
  },
};

/** Max sample points Open-Meteo accepts per request. */
export const OPEN_METEO_BATCH_LIMIT = 100;

// Open-Topo-Data (public instance) — free, no key. Accepts up to 100 locations
// per GET as `lat,lon|lat,lon|…`. The public host rate-limits to ~1 call/sec,
// so it's a good *fallback* rather than primary for big grids.
// https://www.opentopodata.org/api/
export const OPEN_TOPO_DATA_SRTM: ElevationProvider = {
  id: 'opentopodata-srtm',
  label: 'OpenTopoData (SRTM 30m)',
  buildRequest: (points) => {
    const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    return {
      url: `https://api.opentopodata.org/v1/srtm30m?locations=${encodeURIComponent(locations)}`,
    };
  },
  parseResponse: (json) => {
    const results = (json as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new Error('OpenTopoData response missing "results" array.');
    }
    return results.map((entry) => {
      const elevation = (entry as { elevation?: unknown }).elevation;
      return typeof elevation === 'number' ? elevation : 0;
    });
  },
};

// Open-Elevation (public instance) — free, no key. POST batch of {latitude,
// longitude}. Availability is spotty, so it's last in the fallback chain.
// https://open-elevation.com/
export const OPEN_ELEVATION: ElevationProvider = {
  id: 'open-elevation',
  label: 'Open-Elevation',
  buildRequest: (points) => ({
    url: 'https://api.open-elevation.com/api/v1/lookup',
    body: JSON.stringify({
      locations: points.map((p) => ({ latitude: p.lat, longitude: p.lon })),
    }),
    headers: { 'content-type': 'application/json' },
  }),
  parseResponse: (json) => {
    const results = (json as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new Error('Open-Elevation response missing "results" array.');
    }
    return results.map((entry) => {
      const elevation = (entry as { elevation?: unknown }).elevation;
      return typeof elevation === 'number' ? elevation : 0;
    });
  },
};

// Default fallback chain, tried in order until one succeeds. Open-Meteo first
// (most generous throughput), then OpenTopoData, then Open-Elevation.
export const ELEVATION_FALLBACKS: readonly ElevationProvider[] = [
  OPEN_METEO_ELEVATION,
  OPEN_TOPO_DATA_SRTM,
  OPEN_ELEVATION,
];

// Per-provider safe batch sizes (all public hosts document a 100-point max; the
// retry/backoff handles their ~1 req/sec throttling).
export const ELEVATION_BATCH_LIMITS: Record<string, number> = {
  'open-meteo': OPEN_METEO_BATCH_LIMIT,
  'opentopodata-srtm': 100,
  'open-elevation': 100,
};

export function resolveTileUrl(provider: ImageryProvider, x: number, y: number, z: number): string {
  return provider.urlTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{key}', provider.apiKey ?? '');
}
