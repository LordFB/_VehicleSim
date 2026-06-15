import { useState } from 'react';
import { X } from 'lucide-react';
import {
  ESRI_WORLD_IMAGERY,
  fetchHeightGridWithFallback,
  fetchImageryTiles,
  tileRangeForArea,
  zoomForArea,
  type StitchedImagery,
} from '@trackprint/geo';
import {
  createTerrainDocumentFromHeights,
  type TerrainDocument,
} from '@trackprint/terrain-core';

export interface ImportLocationResult {
  readonly terrain: TerrainDocument;
  readonly imagery: StitchedImagery;
}

interface ImportLocationDialogProps {
  /** Keeps the imported area framed where the current terrain sits. */
  readonly defaultCenter?: { readonly x: number; readonly z: number };
  readonly onImport: (result: ImportLocationResult) => void;
  readonly onClose: () => void;
}

// Sensible authoring bounds. Real elevation is ~30-90m, so a tiny area over a
// huge grid just oversamples; cap both to keep fetches fast and reasonable.
const MIN_SIZE = 200;
const MAX_SIZE = 8000;
const RESOLUTION_OPTIONS = [65, 97, 129, 201] as const;

// Satellite imagery detail = target pixels across the area. Higher = sharper
// aerial (more tiles fetched). Independent of the terrain height resolution.
const IMAGERY_DETAIL_OPTIONS = [
  { label: 'Standard (2k)', pixels: 2048 },
  { label: 'High (4k)', pixels: 4096 },
  { label: 'Ultra (8k)', pixels: 8192 },
] as const;

// Famous circuits as one-click presets. Center is roughly the track's bounding
// centroid; `size` is a square (meters) chosen to comfortably enclose the lap.
interface PresetTrack {
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  readonly size: number;
}

const PRESET_TRACKS: readonly PresetTrack[] = [
  { id: 'spa', label: 'Spa-Francorchamps', lat: 50.4372, lon: 5.9714, size: 4000 },
  { id: 'monza', label: 'Monza', lat: 45.6156, lon: 9.2811, size: 3000 },
  { id: 'suzuka', label: 'Suzuka', lat: 34.8431, lon: 136.5419, size: 3000 },
  { id: 'laguna-seca', label: 'Laguna Seca', lat: 36.5847, lon: -121.7536, size: 2500 },
  { id: 'red-bull-ring', label: 'Red Bull Ring (Austria)', lat: 47.2197, lon: 14.7647, size: 2500 },
];

// OpenTopography API key persists in localStorage so it survives reloads. (Not
// a secret worth protecting heavily — a free personal DEM key.) We only ask for
// it when the keyless elevation sources have failed.
const OT_KEY_STORAGE = 'trackprint.opentopography.apiKey';

function loadOpenTopographyKey(): string {
  try {
    return window.localStorage.getItem(OT_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function saveOpenTopographyKey(key: string): void {
  try {
    if (key.trim()) {
      window.localStorage.setItem(OT_KEY_STORAGE, key.trim());
    } else {
      window.localStorage.removeItem(OT_KEY_STORAGE);
    }
  } catch {
    // localStorage unavailable (private mode); key just won't persist.
  }
}

export function ImportLocationDialog({ defaultCenter, onImport, onClose }: ImportLocationDialogProps) {
  const [lat, setLat] = useState('50.4372');
  const [lon, setLon] = useState('5.9714');
  const [sizeMeters, setSizeMeters] = useState(2000);
  const [resolution, setResolution] = useState<number>(129);
  const [imageryDetail, setImageryDetail] = useState<number>(4096);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  // The OpenTopography key prompt only appears after a keyless fetch fails. A
  // previously-saved key is reused silently without showing the prompt.
  const [apiKey, setApiKey] = useState<string>(() => loadOpenTopographyKey());
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  // Empty = "Custom" (user-entered coords); otherwise the chosen preset id.
  const [presetId, setPresetId] = useState('');

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = PRESET_TRACKS.find((track) => track.id === id);
    if (preset) {
      setLat(String(preset.lat));
      setLon(String(preset.lon));
      setSizeMeters(clamp(preset.size, MIN_SIZE, MAX_SIZE, sizeMeters));
      setError('');
    }
  };

  // Typing custom coords detaches from any selected preset.
  const editLat = (value: string) => {
    setLat(value);
    setPresetId('');
  };
  const editLon = (value: string) => {
    setLon(value);
    setPresetId('');
  };

  const runImport = async (openTopographyKey: string) => {
    const center = { lat: Number(lat), lon: Number(lon) };
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
      setError('Enter a valid latitude and longitude.');
      return;
    }
    if (Math.abs(center.lat) > 85) {
      setError('Latitude must be within ±85° (Web-Mercator limit).');
      return;
    }

    setBusy(true);
    setError('');
    setProgress(0);

    try {
      // 1. Satellite imagery: pick a zoom for the area, fetch + stitch tiles.
      setStatus('Fetching satellite imagery…');
      const zoom = zoomForArea(center.lat, sizeMeters, imageryDetail);
      const { tiles, area } = tileRangeForArea(center, sizeMeters, zoom);
      const imagery = await fetchImageryTiles(ESRI_WORLD_IMAGERY, tiles, area, {
        onProgress: (fraction) => setProgress(fraction * 0.6),
      });

      // 2. Elevation: OpenTopography first when a key is available, then the
      //    keyless point providers as fallback when a source is throttled/down.
      setStatus('Fetching elevation…');
      const grid = await fetchHeightGridWithFallback(center, sizeMeters, resolution, resolution, {
        openTopographyKey,
        onProgress: (fraction) => setProgress(0.6 + fraction * 0.4),
        onProviderChange: (source, attempt) =>
          setStatus(attempt === 0 ? `Fetching elevation (${source.label})…` : `Trying ${source.label}…`),
      });

      // 3. Build a terrain document anchored at the current world center so
      //    existing tracks/camera still frame the area correctly.
      const cx = defaultCenter?.x ?? 0;
      const cz = defaultCenter?.z ?? 0;
      const terrain = createTerrainDocumentFromHeights({
        origin: { x: cx - sizeMeters / 2, z: cz - sizeMeters / 2 },
        size: { width: sizeMeters, depth: sizeMeters },
        resolution: { columns: resolution, rows: resolution },
        heights: grid.heights,
        geo: {
          centerLat: center.lat,
          centerLon: center.lon,
          metersPerDegLat: 111_320,
          metersPerDegLon: 111_320 * Math.cos((center.lat * Math.PI) / 180),
          baseElevation: grid.baseElevation,
        },
      });

      onImport({ terrain, imagery });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('Import cancelled.');
      } else {
        setError(caught instanceof Error ? caught.message : 'Import failed.');
        // Every elevation source failed (typically all rate-limited). Offer the
        // OpenTopography key as a more reliable alternative, unless one was
        // already tried.
        if (!openTopographyKey.trim()) {
          setShowKeyPrompt(true);
        }
      }
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  // Default action: use a saved key if present, else go keyless.
  const handleImport = () => {
    void runImport(apiKey);
  };

  // Retry from the key prompt: persist the entered key and import with it.
  const handleRetryWithKey = () => {
    saveOpenTopographyKey(apiKey);
    setShowKeyPrompt(false);
    void runImport(apiKey);
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" data-testid="import-location-dialog">
      <div className="dialog">
        <header className="dialog__title">
          <span>Import real-world location</span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={16} />
          </button>
        </header>

        <p className="tool-hint">
          Fetches real elevation and satellite imagery (Esri World Imagery) for a square area, then
          builds an editable terrain. Pick a preset circuit or paste lat/lon from a maps URL.
        </p>

        <label className="field">
          <span>preset</span>
          <select
            value={presetId}
            onChange={(event) => applyPreset(event.currentTarget.value)}
            disabled={busy}
            data-testid="import-preset"
          >
            <option value="">Custom…</option>
            {PRESET_TRACKS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>latitude</span>
          <input
            type="text"
            inputMode="decimal"
            value={lat}
            onChange={(event) => editLat(event.currentTarget.value)}
            disabled={busy}
            data-testid="import-lat"
          />
        </label>
        <label className="field">
          <span>longitude</span>
          <input
            type="text"
            inputMode="decimal"
            value={lon}
            onChange={(event) => editLon(event.currentTarget.value)}
            disabled={busy}
            data-testid="import-lon"
          />
        </label>
        <label className="field">
          <span>area (m)</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step={100}
            value={sizeMeters}
            onChange={(event) =>
              setSizeMeters(clamp(Number(event.currentTarget.value), MIN_SIZE, MAX_SIZE, sizeMeters))
            }
            disabled={busy}
            data-testid="import-size"
          />
        </label>
        <label className="field">
          <span>resolution</span>
          <select
            value={resolution}
            onChange={(event) => setResolution(Number(event.currentTarget.value))}
            disabled={busy}
            data-testid="import-resolution"
          >
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} × {option}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>imagery</span>
          <select
            value={imageryDetail}
            onChange={(event) => setImageryDetail(Number(event.currentTarget.value))}
            disabled={busy}
            data-testid="import-imagery-detail"
          >
            {IMAGERY_DETAIL_OPTIONS.map((option) => (
              <option key={option.pixels} value={option.pixels}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {busy ? (
          <div className="dialog__progress" data-testid="import-progress">
            <div className="dialog__progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{status}</span>
          </div>
        ) : null}
        {error ? (
          <p className="tool-error" data-testid="import-error">
            {error}
          </p>
        ) : null}

        {showKeyPrompt && !busy ? (
          <div className="dialog__keyprompt" data-testid="import-key-prompt">
            <p className="tool-hint">
              The free elevation services are unavailable or rate-limited. Enter a free{' '}
              <a href="https://portal.opentopography.org" target="_blank" rel="noreferrer">
                OpenTopography
              </a>{' '}
              API key for a reliable global DEM (saved in this browser).
            </p>
            <label className="field">
              <span>OpenTopo key</span>
              <input
                type="text"
                value={apiKey}
                placeholder="paste API key"
                onChange={(event) => setApiKey(event.currentTarget.value)}
                data-testid="import-opentopo-key"
              />
            </label>
          </div>
        ) : null}

        <div className="dialog__actions">
          <button type="button" className="tool-action" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {showKeyPrompt ? (
            <button
              type="button"
              className="tool-action tool-action--primary"
              onClick={handleRetryWithKey}
              disabled={busy || !apiKey.trim()}
              data-testid="import-retry-key"
            >
              {busy ? 'Importing…' : 'Retry with key'}
            </button>
          ) : (
            <button
              type="button"
              className="tool-action tool-action--primary"
              onClick={handleImport}
              disabled={busy}
              data-testid="import-confirm"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}
