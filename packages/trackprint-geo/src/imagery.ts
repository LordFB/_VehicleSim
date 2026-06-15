// Browser-only: fetch XYZ imagery tiles and stitch them into one canvas
// cropped to the exact requested area. The result is usable directly as a
// THREE.CanvasTexture and as a data URL for a reference underlay.

import type { LatLonBounds } from './tiles';
import { lonLatToTileXYFloat } from './tiles';
import type { TileRange } from './tiles';
import { resolveTileUrl, type ImageryProvider } from './providers';

export interface StitchedImagery {
  readonly canvas: HTMLCanvasElement;
  readonly bounds: LatLonBounds;
  readonly provider: string;
  readonly zoom: number;
}

export interface FetchImageryOptions {
  /** Called with 0..1 as tiles load, for UI progress. */
  readonly onProgress?: (fraction: number) => void;
  /** Abort signal to cancel an in-flight import. */
  readonly signal?: AbortSignal;
}

function loadTileImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const onAbort = () => {
      image.src = '';
      reject(new DOMException('Imagery fetch aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    image.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(image);
    };
    image.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`Failed to load imagery tile: ${url}`));
    };
    image.src = url;
  });
}

// Stitch every tile in `tiles` into a big canvas, then crop to the exact
// `area` bbox so the returned image's edges line up with the terrain extents.
export async function fetchImageryTiles(
  provider: ImageryProvider,
  tiles: TileRange,
  area: LatLonBounds,
  options: FetchImageryOptions = {},
): Promise<StitchedImagery> {
  const { z } = tiles;
  const tileSize = provider.tileSize;
  const cols = tiles.xMax - tiles.xMin + 1;
  const rows = tiles.yMax - tiles.yMin + 1;

  // Guard against an accidental thousand-tile fetch at high zoom over a big
  // area. A stitched canvas also can't exceed browser size limits (~16k px).
  const MAX_TILES = 1024; // 32×32 tiles = 8192² px — plenty, and safe.
  if (cols * rows > MAX_TILES) {
    throw new Error(
      `Imagery area too large at this detail (${cols}×${rows} tiles). ` +
        'Reduce the area or imagery detail.',
    );
  }

  const stitched = document.createElement('canvas');
  stitched.width = cols * tileSize;
  stitched.height = rows * tileSize;
  const ctx = stitched.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context for imagery stitching.');
  }

  const total = cols * rows;
  let loaded = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = tiles.yMin; ty <= tiles.yMax; ty += 1) {
    for (let tx = tiles.xMin; tx <= tiles.xMax; tx += 1) {
      const url = resolveTileUrl(provider, tx, ty, z);
      const dx = (tx - tiles.xMin) * tileSize;
      const dy = (ty - tiles.yMin) * tileSize;
      jobs.push(
        loadTileImage(url, options.signal).then((image) => {
          ctx.drawImage(image, dx, dy, tileSize, tileSize);
          loaded += 1;
          options.onProgress?.(loaded / total);
        }),
      );
    }
  }
  await Promise.all(jobs);

  return cropToArea(stitched, tiles, area, tileSize, provider, z);
}

// Crop the stitched tile grid to the precise area bbox. We compute the
// fractional tile coordinate of the bbox corners and slice the corresponding
// pixel rectangle out of the stitched canvas.
function cropToArea(
  stitched: HTMLCanvasElement,
  tiles: TileRange,
  area: LatLonBounds,
  tileSize: number,
  provider: ImageryProvider,
  z: number,
): StitchedImagery {
  const nw = lonLatToTileXYFloat(area.west, area.north, z);
  const se = lonLatToTileXYFloat(area.east, area.south, z);

  const left = (nw.x - tiles.xMin) * tileSize;
  const top = (nw.y - tiles.yMin) * tileSize;
  const right = (se.x - tiles.xMin) * tileSize;
  const bottom = (se.y - tiles.yMin) * tileSize;

  const cropWidth = Math.max(1, Math.round(right - left));
  const cropHeight = Math.max(1, Math.round(bottom - top));

  const cropped = document.createElement('canvas');
  cropped.width = cropWidth;
  cropped.height = cropHeight;
  const ctx = cropped.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context for imagery crop.');
  }
  ctx.drawImage(
    stitched,
    Math.round(left),
    Math.round(top),
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  return { canvas: cropped, bounds: area, provider: provider.id, zoom: z };
}
