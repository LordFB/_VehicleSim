import type { CompileResult, StructureMeshData } from '@trackprint/track-compiler';

export interface TerrainDocument {
  readonly id: string;
  readonly version: 1;
  readonly origin: TerrainPoint;
  readonly size: TerrainSize;
  readonly resolution: TerrainResolution;
  readonly heights: readonly number[];
  readonly materials: readonly string[];
  readonly masks: readonly TerrainMask[];
  readonly brushStrokes: readonly TerrainBrushStroke[];
  /**
   * Optional real-world anchor for terrain imported from a geographic
   * location. Absent for procedural terrain. Uses a local tangent-plane
   * (meters-per-degree at the center) rather than a full CRS — enough to
   * re-fetch/re-export the area without heavy GIS dependencies.
   */
  readonly geo?: TerrainGeoAnchor;
}

export interface TerrainGeoAnchor {
  readonly centerLat: number;
  readonly centerLon: number;
  readonly metersPerDegLat: number;
  readonly metersPerDegLon: number;
  /** Raw elevation (meters) subtracted from heights so the low point ≈ 0. */
  readonly baseElevation: number;
}

export interface TerrainPoint {
  readonly x: number;
  readonly z: number;
}

export interface TerrainSize {
  readonly width: number;
  readonly depth: number;
}

export interface TerrainResolution {
  readonly columns: number;
  readonly rows: number;
}

export type TerrainMask = 'locked' | 'skirt' | 'free';

export interface TerrainCell {
  readonly column: number;
  readonly row: number;
}

export interface TerrainMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly colors?: Float32Array;
  readonly materialIds: readonly string[];
}

export interface CorridorBoundary {
  readonly left: readonly TerrainVertex[];
  readonly right: readonly TerrainVertex[];
  readonly polygon: readonly TerrainPoint[];
  readonly closed: boolean;
}

export interface TerrainVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly station: number;
}

export interface SkirtMeshData extends TerrainMeshData {
  readonly seam: readonly SeamMetadata[];
}

export interface SeamMetadata {
  readonly station: number;
  readonly side: 'left' | 'right';
  readonly innerVertexIndex: number;
  readonly outerVertexIndex: number;
}

export interface TerrainMaskOptions {
  readonly blendWidth: number;
}

// A wrap-aware station window. `closed`/`totalLength` let a range straddle the
// loop seam (start > end). Used to suppress skirt rows and terrain carving over
// bridge/tunnel spans. Terrain-core has no StationLookup, so callers pass the
// loop metadata alongside the ranges.
export interface StationRange {
  readonly start: number;
  readonly end: number;
}

export interface StationRangeSet {
  readonly ranges: readonly StationRange[];
  readonly closed: boolean;
  readonly totalLength: number;
}

function stationInRangeSet(station: number, set: StationRangeSet | undefined): boolean {
  if (!set || set.ranges.length === 0) {
    return false;
  }
  for (const range of set.ranges) {
    if (set.closed && range.start > range.end) {
      if (station >= range.start - 1e-6 || station <= range.end + 1e-6) {
        return true;
      }
    } else if (station >= range.start - 1e-6 && station <= range.end + 1e-6) {
      return true;
    }
  }
  return false;
}

export interface TerrainValidationIssue {
  readonly code: 'terrain-bounds' | 'terrain-skirt' | 'terrain-seam';
  readonly message: string;
}

export type TerrainBrushType = 'raise' | 'lower' | 'smooth' | 'flatten' | 'material';
export type TerrainBrushFalloff = 'linear' | 'smooth' | 'constant';

export interface TerrainBrushSettings {
  readonly type: TerrainBrushType;
  readonly radius: number;
  readonly strength: number;
  readonly falloff: TerrainBrushFalloff;
  readonly targetHeight?: number;
  readonly targetMaterial?: string;
}

export interface TerrainBrushStroke {
  readonly id: string;
  readonly type: TerrainBrushType;
  readonly points: readonly TerrainPoint[];
  readonly radius: number;
  readonly strength: number;
  readonly falloff: TerrainBrushFalloff;
  readonly targetHeight?: number;
  readonly targetMaterial?: string;
  readonly timestamp: number;
}

export function createTerrainDocument(options: {
  readonly id?: string;
  readonly origin?: TerrainPoint;
  readonly size?: TerrainSize;
  readonly resolution?: TerrainResolution;
  readonly defaultHeight?: number;
  readonly defaultMaterial?: string;
} = {}): TerrainDocument {
  const resolution = options.resolution ?? { columns: 65, rows: 65 };
  const cellCount = resolution.columns * resolution.rows;
  return {
    id: options.id ?? 'terrain',
    version: 1,
    origin: options.origin ?? { x: -160, z: -160 },
    size: options.size ?? { width: 320, depth: 320 },
    resolution,
    heights: Array.from({ length: cellCount }, () => options.defaultHeight ?? 0),
    materials: Array.from({ length: cellCount }, () => options.defaultMaterial ?? 'grass'),
    masks: Array.from({ length: cellCount }, () => 'free'),
    brushStrokes: [],
  };
}

// Build a terrain document seeded from a precomputed height grid (e.g. real
// elevation from @trackprint/geo) instead of a constant fill. `heights` must be
// row-major and length columns*rows, matching heights[row*columns + column].
export function createTerrainDocumentFromHeights(options: {
  readonly id?: string;
  readonly origin: TerrainPoint;
  readonly size: TerrainSize;
  readonly resolution: TerrainResolution;
  readonly heights: readonly number[];
  readonly defaultMaterial?: string;
  readonly geo?: TerrainGeoAnchor;
}): TerrainDocument {
  const cellCount = options.resolution.columns * options.resolution.rows;
  if (options.heights.length !== cellCount) {
    throw new Error(
      `Height grid length ${options.heights.length} does not match resolution ${options.resolution.columns}x${options.resolution.rows} (${cellCount}).`,
    );
  }
  return {
    id: options.id ?? 'terrain',
    version: 1,
    origin: options.origin,
    size: options.size,
    resolution: options.resolution,
    heights: [...options.heights],
    materials: Array.from({ length: cellCount }, () => options.defaultMaterial ?? 'grass'),
    masks: Array.from({ length: cellCount }, () => 'free'),
    brushStrokes: [],
    geo: options.geo,
  };
}

export function worldToCell(document: TerrainDocument, point: TerrainPoint): TerrainCell {
  const xAlpha = (point.x - document.origin.x) / Math.max(document.size.width, 1e-9);
  const zAlpha = (point.z - document.origin.z) / Math.max(document.size.depth, 1e-9);
  return {
    column: clamp(Math.round(xAlpha * (document.resolution.columns - 1)), 0, document.resolution.columns - 1),
    row: clamp(Math.round(zAlpha * (document.resolution.rows - 1)), 0, document.resolution.rows - 1),
  };
}

export function cellToWorld(document: TerrainDocument, cell: TerrainCell): TerrainPoint {
  const xStep = document.size.width / Math.max(document.resolution.columns - 1, 1);
  const zStep = document.size.depth / Math.max(document.resolution.rows - 1, 1);
  return {
    x: document.origin.x + clamp(cell.column, 0, document.resolution.columns - 1) * xStep,
    z: document.origin.z + clamp(cell.row, 0, document.resolution.rows - 1) * zStep,
  };
}

export function sampleTerrainHeight(document: TerrainDocument, point: TerrainPoint): number {
  const cell = worldToCell(document, point);
  return document.heights[cellIndex(document, cell)] ?? 0;
}

export function sampleTerrainHeightBilinear(document: TerrainDocument, point: TerrainPoint): number {
  const { columns, rows } = document.resolution;
  if (columns < 2 || rows < 2) {
    return sampleTerrainHeight(document, point);
  }
  const xAlpha = ((point.x - document.origin.x) / Math.max(document.size.width, 1e-9)) * (columns - 1);
  const zAlpha = ((point.z - document.origin.z) / Math.max(document.size.depth, 1e-9)) * (rows - 1);
  const x0 = Math.max(0, Math.min(columns - 1, Math.floor(xAlpha)));
  const z0 = Math.max(0, Math.min(rows - 1, Math.floor(zAlpha)));
  const x1 = Math.min(columns - 1, x0 + 1);
  const z1 = Math.min(rows - 1, z0 + 1);
  const fx = Math.min(Math.max(xAlpha - x0, 0), 1);
  const fz = Math.min(Math.max(zAlpha - z0, 0), 1);
  const h00 = document.heights[z0 * columns + x0] ?? 0;
  const h10 = document.heights[z0 * columns + x1] ?? 0;
  const h01 = document.heights[z1 * columns + x0] ?? 0;
  const h11 = document.heights[z1 * columns + x1] ?? 0;
  const hx0 = h00 + (h10 - h00) * fx;
  const hx1 = h01 + (h11 - h01) * fx;
  return hx0 + (hx1 - hx0) * fz;
}

export function sampleTerrainMaterial(document: TerrainDocument, point: TerrainPoint): string {
  const cell = worldToCell(document, point);
  return document.materials[cellIndex(document, cell)] ?? 'default';
}

export function generateTerrainMesh(document: TerrainDocument): TerrainMeshData {
  const { columns, rows } = document.resolution;
  const positions = new Float32Array(columns * rows * 3);
  const normals = new Float32Array(columns * rows * 3);
  const colors = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  const rawIndices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const vertex = row * columns + column;
      const world = cellToWorld(document, { column, row });
      positions[vertex * 3] = world.x;
      positions[vertex * 3 + 1] = document.heights[vertex] ?? 0;
      positions[vertex * 3 + 2] = world.z;
      const color = materialColor(document.materials[vertex] ?? 'grass');
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
      uvs[vertex * 2] = columns <= 1 ? 0 : column / (columns - 1);
      uvs[vertex * 2 + 1] = rows <= 1 ? 0 : row / (rows - 1);
    }
  }

  writeTerrainNormals(document, normals);

  const maskOf = (vertex: number): TerrainMask => document.masks[vertex] ?? 'free';
  const isOpaque = (vertex: number): boolean => {
    const mask = maskOf(vertex);
    return mask !== 'locked' && mask !== 'skirt';
  };

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      if (isOpaque(a) && isOpaque(b) && isOpaque(c)) {
        rawIndices.push(a, c, b);
      }
      if (isOpaque(b) && isOpaque(d) && isOpaque(c)) {
        rawIndices.push(b, c, d);
      }
    }
  }

  return compactTerrainMesh({
    positions,
    normals,
    uvs,
    indices: Uint32Array.from(rawIndices),
    colors,
    materialIds: [...new Set(document.materials)],
  });
}

function compactTerrainMesh(mesh: TerrainMeshData): TerrainMeshData {
  const indexCount = mesh.indices.length;
  if (indexCount === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint32Array(0),
      colors: mesh.colors ? new Float32Array(0) : undefined,
      materialIds: mesh.materialIds,
    };
  }

  const vertexCount = mesh.positions.length / 3;
  const remap = new Int32Array(vertexCount);
  remap.fill(-1);

  let next = 0;
  for (let i = 0; i < indexCount; i += 1) {
    const original = mesh.indices[i];
    if (remap[original] === -1) {
      remap[original] = next;
      next += 1;
    }
  }

  if (next === vertexCount) {
    return mesh;
  }

  const positions = new Float32Array(next * 3);
  const normals = new Float32Array(next * 3);
  const uvs = new Float32Array(next * 2);
  const colors = mesh.colors ? new Float32Array(next * 3) : undefined;

  for (let v = 0; v < vertexCount; v += 1) {
    const target = remap[v];
    if (target === -1) {
      continue;
    }
    positions[target * 3] = mesh.positions[v * 3];
    positions[target * 3 + 1] = mesh.positions[v * 3 + 1];
    positions[target * 3 + 2] = mesh.positions[v * 3 + 2];
    normals[target * 3] = mesh.normals[v * 3];
    normals[target * 3 + 1] = mesh.normals[v * 3 + 1];
    normals[target * 3 + 2] = mesh.normals[v * 3 + 2];
    uvs[target * 2] = mesh.uvs[v * 2];
    uvs[target * 2 + 1] = mesh.uvs[v * 2 + 1];
    if (colors && mesh.colors) {
      colors[target * 3] = mesh.colors[v * 3];
      colors[target * 3 + 1] = mesh.colors[v * 3 + 1];
      colors[target * 3 + 2] = mesh.colors[v * 3 + 2];
    }
  }

  const compactIndices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i += 1) {
    compactIndices[i] = remap[mesh.indices[i]];
  }

  return {
    positions,
    normals,
    uvs,
    indices: compactIndices,
    colors,
    materialIds: mesh.materialIds,
  };
}

export function applyTerrainBrush(
  document: TerrainDocument,
  point: TerrainPoint,
  settings: TerrainBrushSettings,
): TerrainDocument {
  const radius = Math.max(settings.radius, 0);
  if (radius <= 0) {
    return document;
  }

  if (settings.type === 'smooth') {
    return smoothTerrain(document, point, settings);
  }

  const heights = [...document.heights];
  const materials = [...document.materials];
  forEachBrushCell(document, point, radius, (index, distance) => {
    if (document.masks[index] !== 'free') {
      return;
    }

    const weight = falloffWeight(distance / radius, settings.falloff);
    if (settings.type === 'raise') {
      heights[index] = (heights[index] ?? 0) + settings.strength * weight;
    } else if (settings.type === 'lower') {
      heights[index] = (heights[index] ?? 0) - settings.strength * weight;
    } else if (settings.type === 'flatten') {
      const target = settings.targetHeight ?? sampleTerrainHeight(document, point);
      heights[index] = lerp(heights[index] ?? 0, target, clamp01(settings.strength * weight));
    } else if (settings.type === 'material' && settings.targetMaterial) {
      materials[index] = settings.targetMaterial;
    }
  });

  return { ...document, heights, materials };
}

export function appendTerrainBrushStroke(
  document: TerrainDocument,
  stroke: TerrainBrushStroke,
): TerrainDocument {
  return { ...document, brushStrokes: [...document.brushStrokes, stroke] };
}

export function serializeTerrainDocument(document: TerrainDocument): string {
  return JSON.stringify(document);
}

export function deserializeTerrainDocument(serialized: string): TerrainDocument {
  const parsed = JSON.parse(serialized) as Partial<TerrainDocument>;
  const resolution = parsed.resolution ?? { columns: 1, rows: 1 };
  const cellCount = resolution.columns * resolution.rows;
  return {
    id: parsed.id ?? 'terrain',
    version: 1,
    origin: parsed.origin ?? { x: 0, z: 0 },
    size: parsed.size ?? { width: 1, depth: 1 },
    resolution,
    heights: normalizeArray(parsed.heights, cellCount, 0),
    materials: normalizeArray(parsed.materials, cellCount, 'grass'),
    masks: normalizeArray(parsed.masks, cellCount, 'free') as TerrainMask[],
    brushStrokes: parsed.brushStrokes ?? [],
    geo: parsed.geo,
  };
}

export function deriveCorridorBoundary(surface: CompileResult): CorridorBoundary {
  const left = surface.crossSections.map((section, row) =>
    activeOuterVertex(surface, 'left', row) ?? {
      x: section.leftEdge.x,
      y: section.leftHeight,
      z: section.leftEdge.y,
      station: section.station,
    },
  );
  const right = surface.crossSections.map((section, row) =>
    activeOuterVertex(surface, 'right', row) ?? {
      x: section.rightEdge.x,
      y: section.rightHeight,
      z: section.rightEdge.y,
      station: section.station,
    },
  );

  return {
    left,
    right,
    polygon: [
      ...left.map(({ x, z }) => ({ x, z })),
      ...[...right].reverse().map(({ x, z }) => ({ x, z })),
    ],
    closed: surface.closed,
  };
}

export function applyTerrainMasks(
  document: TerrainDocument,
  boundary: CorridorBoundary,
  options: TerrainMaskOptions,
  holeSuppress?: StationRangeSet,
): TerrainDocument {
  const polygon = boundary.polygon;
  const masks: TerrainMask[] = new Array(document.resolution.columns * document.resolution.rows);
  if (polygon.length < 3) {
    masks.fill('free');
    return { ...document, masks };
  }

  // Over a bridge/tunnel span the terrain must stay solid (not carved, not
  // skirted): the valley shows through under a bridge and the mountain stays
  // closed over a tunnel bore. For any cell the base pass would lock/skirt, we
  // look up the nearest corridor-boundary station and free it if suppressed.
  const suppressVertices =
    holeSuppress && holeSuppress.ranges.length > 0 ? [...boundary.left, ...boundary.right] : null;
  const isSuppressed = (point: TerrainPoint): boolean => {
    if (!suppressVertices) {
      return false;
    }
    let bestStation = 0;
    let bestDistance = Infinity;
    for (const vertex of suppressVertices) {
      const distance = (vertex.x - point.x) ** 2 + (vertex.z - point.z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestStation = vertex.station;
      }
    }
    return stationInRangeSet(bestStation, holeSuppress);
  };

  // Build a uniform-grid spatial index for polygon edges so each terrain
  // cell only tests the handful of edges in its neighborhood instead of
  // all ~1500. With a 200x200 grid this turns mask compute from ~60M ops
  // into a few hundred thousand.
  const index = buildSegmentIndex(polygon, options.blendWidth);

  // Pre-compute the row-by-row crossing parity for point-in-polygon. We
  // scan each row left to right and only flip "inside" when an edge
  // crosses; this is the standard scanline rasterization trick.
  let i = 0;
  for (let row = 0; row < document.resolution.rows; row += 1) {
    for (let column = 0; column < document.resolution.columns; column += 1) {
      const point = cellToWorld(document, { column, row });
      if (pointInPolygonIndexed(point, polygon, index)) {
        masks[i] = 'locked';
      } else if (distanceToPolylineIndexed(point, polygon, index, options.blendWidth) <= options.blendWidth) {
        masks[i] = 'skirt';
      } else {
        masks[i] = 'free';
      }
      // Keep the terrain closed over structure spans.
      if (masks[i] !== 'free' && isSuppressed(point)) {
        masks[i] = 'free';
      }
      i += 1;
    }
  }

  return { ...document, masks };
}

interface SegmentIndex {
  readonly grid: number[][];
  readonly cellSize: number;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  readonly segMinX: Float32Array;
  readonly segMinZ: Float32Array;
  readonly segMaxX: Float32Array;
  readonly segMaxZ: Float32Array;
}

function buildSegmentIndex(polygon: readonly TerrainPoint[], padding: number): SegmentIndex {
  const n = polygon.length;
  const segMinX = new Float32Array(n);
  const segMinZ = new Float32Array(n);
  const segMaxX = new Float32Array(n);
  const segMaxZ = new Float32Array(n);
  let polyMinX = Number.POSITIVE_INFINITY;
  let polyMinZ = Number.POSITIVE_INFINITY;
  let polyMaxX = Number.NEGATIVE_INFINITY;
  let polyMaxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    segMinX[i] = Math.min(a.x, b.x);
    segMinZ[i] = Math.min(a.z, b.z);
    segMaxX[i] = Math.max(a.x, b.x);
    segMaxZ[i] = Math.max(a.z, b.z);
    if (segMinX[i] < polyMinX) polyMinX = segMinX[i];
    if (segMinZ[i] < polyMinZ) polyMinZ = segMinZ[i];
    if (segMaxX[i] > polyMaxX) polyMaxX = segMaxX[i];
    if (segMaxZ[i] > polyMaxZ) polyMaxZ = segMaxZ[i];
  }

  const expand = Math.max(padding, 1);
  polyMinX -= expand;
  polyMinZ -= expand;
  polyMaxX += expand;
  polyMaxZ += expand;
  const span = Math.max(polyMaxX - polyMinX, polyMaxZ - polyMinZ, 1);
  const targetCells = 48;
  const cellSize = Math.max(span / targetCells, expand);
  const cols = Math.max(1, Math.ceil((polyMaxX - polyMinX) / cellSize));
  const rows = Math.max(1, Math.ceil((polyMaxZ - polyMinZ) / cellSize));
  const grid: number[][] = new Array(cols * rows);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = [];
  }

  for (let i = 0; i < n; i += 1) {
    const minCol = Math.max(0, Math.floor((segMinX[i] - expand - polyMinX) / cellSize));
    const maxCol = Math.min(cols - 1, Math.floor((segMaxX[i] + expand - polyMinX) / cellSize));
    const minRow = Math.max(0, Math.floor((segMinZ[i] - expand - polyMinZ) / cellSize));
    const maxRow = Math.min(rows - 1, Math.floor((segMaxZ[i] + expand - polyMinZ) / cellSize));
    for (let r = minRow; r <= maxRow; r += 1) {
      for (let c = minCol; c <= maxCol; c += 1) {
        grid[r * cols + c].push(i);
      }
    }
  }

  return { grid, cellSize, minX: polyMinX, minZ: polyMinZ, cols, rows, segMinX, segMinZ, segMaxX, segMaxZ };
}

function pointInPolygonIndexed(point: TerrainPoint, polygon: readonly TerrainPoint[], index: SegmentIndex): boolean {
  // Walk every row's segment bucket that crosses point.z. We still need
  // an even-odd test over all crossing edges, not just the ones in the
  // local bucket, so we test by Z-range against the cached bbox.
  let inside = false;
  for (let i = 0; i < polygon.length; i += 1) {
    if (point.z < index.segMinZ[i] || point.z > index.segMaxZ[i]) {
      continue;
    }
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a.z === b.z) {
      continue;
    }
    if ((a.z > point.z) === (b.z > point.z)) {
      continue;
    }
    const xAtZ = a.x + ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z);
    if (point.x < xAtZ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolylineIndexed(
  point: TerrainPoint,
  polygon: readonly TerrainPoint[],
  index: SegmentIndex,
  cutoff: number,
): number {
  const col = Math.floor((point.x - index.minX) / index.cellSize);
  const row = Math.floor((point.z - index.minZ) / index.cellSize);
  if (col < 0 || row < 0 || col >= index.cols || row >= index.rows) {
    // The index grid spans the polygon's bounding box already expanded by
    // `expand` (>= cutoff). A point outside the grid is therefore farther
    // than the cutoff from every edge, so it is unambiguously beyond the
    // skirt — return a value past the cutoff without scanning any segments.
    // Without this early-out, a small corridor inside a large terrain forces
    // tens of thousands of cells to scan every edge (O(cells x edges)).
    return cutoff + index.cellSize;
  }
  return distanceFromBucket(point, polygon, index, col, row, cutoff);
}

function distanceFromBucket(
  point: TerrainPoint,
  polygon: readonly TerrainPoint[],
  index: SegmentIndex,
  col: number,
  row: number,
  cutoff: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  const reach = 1;
  for (let r = Math.max(0, row - reach); r <= Math.min(index.rows - 1, row + reach); r += 1) {
    for (let c = Math.max(0, col - reach); c <= Math.min(index.cols - 1, col + reach); c += 1) {
      const bucket = index.grid[r * index.cols + c];
      for (const segIndex of bucket) {
        const a = polygon[segIndex];
        const b = polygon[(segIndex + 1) % polygon.length];
        const distance = distanceToSegment(point, a, b);
        if (distance < best) {
          best = distance;
          if (best <= 0) {
            return 0;
          }
        }
      }
    }
  }
  // If nothing was in the local neighborhood, fall back to a full scan
  // (rare; only happens for points outside the polygon's expanded bbox).
  if (!Number.isFinite(best)) {
    return distanceToPolyline(point, polygon);
  }
  // Even when we found something locally, the true nearest segment may
  // lie just past the explored radius. The cutoff lets us early-exit:
  // if the best so far is already greater than `cutoff`, the caller
  // only needs to know "outside skirt" — exact value doesn't matter.
  if (best > cutoff) {
    return best;
  }
  return best;
}

export function generateSkirtMesh(
  document: TerrainDocument,
  boundary: CorridorBoundary,
  blendWidth: number,
  subdivisions = 10,
  suppressLeft?: StationRangeSet,
  suppressRight?: StationRangeSet,
): SkirtMeshData {
  const rings = Math.max(Math.floor(subdivisions), 1);
  const ringCount = rings + 1;
  const leftSlot = boundary.left.length * ringCount;
  const rightSlot = boundary.right.length * ringCount;
  const totalVertices = leftSlot + rightSlot;
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = new Float32Array(totalVertices * 2);
  const colors = new Float32Array(totalVertices * 3);
  const seam: SeamMetadata[] = [];
  const rawIndices: number[] = [];

  const xStep = document.size.width / Math.max(document.resolution.columns - 1, 1);
  const zStep = document.size.depth / Math.max(document.resolution.rows - 1, 1);
  const cellDiagonal = Math.hypot(xStep, zStep);
  // Reach past the dropped terrain hole. Terrain mesh drops triangles whose
  // vertex falls in the skirt mask zone (width = blendWidth), so the kept
  // free cells start ~one cell beyond it. Overshoot by 1.5× the cell diagonal
  // so the outer ring sits ON the first kept free cells.
  const skirtReach = blendWidth + cellDiagonal * 1.5;

  const writeSide = (
    side: 'left' | 'right',
    source: readonly TerrainVertex[],
    baseVertex: number,
    flip: boolean,
    suppress: StationRangeSet | undefined,
  ) => {
    const stationCount = source.length;
    for (let station = 0; station < stationCount; station += 1) {
      const inner = source[station];
      const outward = outwardDirection(side, source, station, boundary);
      const outerPoint = {
        x: inner.x + outward.x * skirtReach,
        z: inner.z + outward.z * skirtReach,
      };
      const outerHeight = sampleTerrainHeightBilinear(document, outerPoint);
      const outerMaterial = sampleTerrainMaterial(document, outerPoint);
      const outerColor = materialColor(outerMaterial);
      const innerVertex = baseVertex + station * ringCount;
      const outerVertex = innerVertex + rings;

      for (let ring = 0; ring < ringCount; ring += 1) {
        const t = ring / rings;
        // Quintic smootherstep: 6t^5 - 15t^4 + 10t^3 — C2 continuous,
        // unlike cubic smoothstep its second derivative is zero at the ends,
        // so the slope ramps in/out without visible kinks at the seam.
        const eased = t * t * t * (t * (t * 6 - 15) + 10);
        const x = inner.x + outward.x * skirtReach * t;
        const z = inner.z + outward.z * skirtReach * t;
        const y = ring === 0
          ? inner.y
          : ring === rings
            ? outerHeight
            : lerp(inner.y, outerHeight, eased);
        const vertex = innerVertex + ring;
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        normals[vertex * 3] = 0;
        normals[vertex * 3 + 1] = 1;
        normals[vertex * 3 + 2] = 0;
        uvs[vertex * 2] = t;
        uvs[vertex * 2 + 1] = stationCount <= 1 ? 0 : station / Math.max(stationCount - 1, 1);

        // Inner ring blends from track-edge tone into terrain tone.
        // Past the midpoint, use the actual terrain material at that ring's
        // XZ so the skirt visually dissolves into grass/gravel/dirt.
        const sampleMaterial = ring < 2 ? null : sampleTerrainMaterial(document, { x, z });
        const localColor = sampleMaterial ? materialColor(sampleMaterial) : outerColor;
        const blend = ring === 0 ? 0 : ring < 2 ? 0.4 : 1;
        colors[vertex * 3] = lerp(SKIRT_EDGE_TINT.r, localColor.r, blend);
        colors[vertex * 3 + 1] = lerp(SKIRT_EDGE_TINT.g, localColor.g, blend);
        colors[vertex * 3 + 2] = lerp(SKIRT_EDGE_TINT.b, localColor.b, blend);
      }

      seam.push({ station: inner.station, side, innerVertexIndex: innerVertex, outerVertexIndex: outerVertex });
    }

    const segmentCount = boundary.closed ? stationCount : stationCount - 1;
    for (let station = 0; station < segmentCount; station += 1) {
      const nextStation = (station + 1) % stationCount;
      // Drop the skirt quad over a suppressed span (bridge/tunnel). We still
      // wrote the vertices above so indices stay contiguous; only the triangles
      // are skipped, leaving a clean gap where structure geometry takes over.
      if (
        stationInRangeSet(source[station].station, suppress) ||
        stationInRangeSet(source[nextStation].station, suppress)
      ) {
        continue;
      }
      for (let ring = 0; ring < rings; ring += 1) {
        const a = baseVertex + station * ringCount + ring;
        const b = a + 1;
        const c = baseVertex + nextStation * ringCount + ring;
        const d = c + 1;
        if (flip) {
          rawIndices.push(a, c, b, b, c, d);
        } else {
          rawIndices.push(a, b, c, b, d, c);
        }
      }
    }
  };

  // Left/right sides wind oppositely so both skirt faces point up. The base
  // flip (left=false, right=true) is correct when the corridor loop runs one
  // way; a clockwise-authored loop advances its boundary stations the other way
  // around, which reverses both windings. Detect the corridor circulation and
  // fold it into the per-side flip so the skirt stays front-facing either way.
  const clockwise = isClockwiseCorridor(boundary);
  writeSide('left', boundary.left, 0, clockwise, suppressLeft);
  writeSide('right', boundary.right, leftSlot, !clockwise, suppressRight);

  computeSkirtNormals(positions, rawIndices, normals);

  return {
    positions,
    normals,
    uvs,
    indices: Uint32Array.from(rawIndices),
    colors,
    materialIds: ['skirt', ...Array.from(new Set(document.materials))],
    seam,
  };
}

const SKIRT_EDGE_TINT = { r: 0.18, g: 0.32, b: 0.46 };

// Drop a square pillar from each bridge deck's underside down to the terrain at
// coarse station intervals. Returns a single merged mesh (or null if empty).
// `pillarSpacing` is the along-span gap between pillars in meters.
export function generateBridgePillars(
  document: TerrainDocument,
  structures: readonly StructureMeshData[],
  options: { readonly pillarSpacing?: number; readonly pillarHalfWidth?: number } = {},
): TerrainMeshData | null {
  const spacing = Math.max(options.pillarSpacing ?? 18, 1);
  const half = Math.max(options.pillarHalfWidth ?? 0.6, 0.05);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const structure of structures) {
    if (structure.kind !== 'bridge' || structure.deckUnderside.length === 0) {
      continue;
    }
    let lastStation = -Infinity;
    for (const point of structure.deckUnderside) {
      if (point.station - lastStation < spacing) {
        continue;
      }
      const groundY = sampleTerrainHeightBilinear(document, { x: point.x, z: point.z });
      // Skip degenerate pillars where the deck is at/under the ground (span end
      // ramp): nothing to hold up there.
      if (point.y - groundY <= 0.2) {
        continue;
      }
      lastStation = point.station;
      appendBox(positions, normals, uvs, indices, point.x, point.z, groundY, point.y, half);
    }
  }

  if (indices.length === 0) {
    return null;
  }

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  computeSkirtNormals(positionArray, indices, normalArray);
  return {
    positions: positionArray,
    normals: normalArray,
    uvs: new Float32Array(uvs),
    indices: Uint32Array.from(indices),
    colors: undefined,
    materialIds: ['pillar'],
  };
}

function appendBox(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  cx: number,
  cz: number,
  bottomY: number,
  topY: number,
  half: number,
) {
  const base = positions.length / 3;
  const corners: [number, number][] = [
    [cx - half, cz - half],
    [cx + half, cz - half],
    [cx + half, cz + half],
    [cx - half, cz + half],
  ];
  // 8 vertices: bottom ring then top ring.
  for (const [x, z] of corners) {
    positions.push(x, bottomY, z);
    normals.push(0, 1, 0);
    uvs.push(0, 0);
  }
  for (const [x, z] of corners) {
    positions.push(x, topY, z);
    normals.push(0, 1, 0);
    uvs.push(0, 1);
  }
  // 4 side quads.
  for (let i = 0; i < 4; i += 1) {
    const next = (i + 1) % 4;
    const b0 = base + i;
    const b1 = base + next;
    const t0 = base + 4 + i;
    const t1 = base + 4 + next;
    indices.push(b0, t0, b1, b1, t0, t1);
  }
}

// Stitch each tunnel portal cap to the surrounding terrain with a triangle
// strip: each cap ring vertex pairs with a terrain point projected radially
// outward from the bore center, so a skewed mouth closes vertex-by-vertex
// without a non-planar quad. Reuses the inner-ring -> outer-ring topology from
// the skirt.
export function generatePortalFill(
  document: TerrainDocument,
  structures: readonly StructureMeshData[],
  options: { readonly reach?: number } = {},
): TerrainMeshData | null {
  const reach = Math.max(options.reach ?? 6, 0.5);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const structure of structures) {
    if (structure.kind !== 'tunnel' || structure.rowCount < 1) {
      continue;
    }
    const columnCount = structure.columnCount;
    appendPortalRingFill(structure, 0, columnCount, reach, document, positions, normals, uvs, indices);
    const lastRow = structure.rowCount - 1;
    appendPortalRingFill(structure, lastRow, columnCount, reach, document, positions, normals, uvs, indices);
  }

  if (indices.length === 0) {
    return null;
  }

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  computeSkirtNormals(positionArray, indices, normalArray);
  return {
    positions: positionArray,
    normals: normalArray,
    uvs: new Float32Array(uvs),
    indices: Uint32Array.from(indices),
    colors: undefined,
    materialIds: ['portal'],
  };
}

function appendPortalRingFill(
  structure: StructureMeshData,
  row: number,
  columnCount: number,
  reach: number,
  document: TerrainDocument,
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const ringBase = row * columnCount;
  // Ring center (for the radial outward direction).
  let cx = 0;
  let cz = 0;
  for (let column = 0; column < columnCount; column += 1) {
    cx += structure.positions[(ringBase + column) * 3];
    cz += structure.positions[(ringBase + column) * 3 + 2];
  }
  cx /= columnCount;
  cz /= columnCount;

  const base = positions.length / 3;
  for (let column = 0; column < columnCount; column += 1) {
    const px = structure.positions[(ringBase + column) * 3];
    const py = structure.positions[(ringBase + column) * 3 + 1];
    const pz = structure.positions[(ringBase + column) * 3 + 2];
    // Inner vertex: on the cap ring.
    positions.push(px, py, pz);
    normals.push(0, 1, 0);
    uvs.push(column / Math.max(columnCount - 1, 1), 0);
    // Outer vertex: projected outward to terrain height.
    let dirX = px - cx;
    let dirZ = pz - cz;
    const length = Math.hypot(dirX, dirZ) || 1;
    dirX /= length;
    dirZ /= length;
    const ox = px + dirX * reach;
    const oz = pz + dirZ * reach;
    const oy = sampleTerrainHeightBilinear(document, { x: ox, z: oz });
    positions.push(ox, oy, oz);
    normals.push(0, 1, 0);
    uvs.push(column / Math.max(columnCount - 1, 1), 1);
  }

  // Strip between consecutive (inner,outer) pairs around the ring.
  for (let column = 0; column < columnCount; column += 1) {
    const next = (column + 1) % columnCount;
    const innerA = base + column * 2;
    const outerA = innerA + 1;
    const innerB = base + next * 2;
    const outerB = innerB + 1;
    indices.push(innerA, outerA, innerB, innerB, outerA, outerB);
  }
}

export function validateTerrainBoundary(
  document: TerrainDocument,
  boundary: CorridorBoundary,
  options: TerrainMaskOptions,
): TerrainValidationIssue[] {
  const issues: TerrainValidationIssue[] = [];
  const minX = document.origin.x;
  const maxX = document.origin.x + document.size.width;
  const minZ = document.origin.z;
  const maxZ = document.origin.z + document.size.depth;
  const padding = Math.max(options.blendWidth, 0);

  const allBoundaryVertices = [...boundary.left, ...boundary.right];
  if (boundary.left.length < 2 || boundary.right.length < 2 || boundary.polygon.length < 4) {
    issues.push({
      code: 'terrain-seam',
      message: 'Terrain seam cannot be rebuilt from the current corridor boundary.',
    });
  }

  if (
    allBoundaryVertices.some((vertex) =>
      !Number.isFinite(vertex.x) ||
      !Number.isFinite(vertex.y) ||
      !Number.isFinite(vertex.z) ||
      !Number.isFinite(vertex.station),
    )
  ) {
    issues.push({
      code: 'terrain-seam',
      message: 'Terrain seam contains non-finite vertices.',
    });
  }

  if (
    allBoundaryVertices.some((vertex) =>
      vertex.x - padding < minX ||
      vertex.x + padding > maxX ||
      vertex.z - padding < minZ ||
      vertex.z + padding > maxZ,
    )
  ) {
    issues.push({
      code: 'terrain-bounds',
      message: 'Track corridor or skirt extends beyond terrain bounds.',
    });
  }

  if (hasZeroLengthBoundaryEdges(boundary.left) || hasZeroLengthBoundaryEdges(boundary.right)) {
    issues.push({
      code: 'terrain-skirt',
      message: 'Terrain skirt has overlapping seam vertices.',
    });
  }

  return issues;
}

function activeOuterVertex(
  surface: CompileResult,
  side: 'left' | 'right',
  surfaceRow: number,
): TerrainVertex | null {
  const section = surface.crossSections[surfaceRow];
  if (!section) {
    return null;
  }
  const station = section.station;
  // The corridor boundary is the outermost edge of paved/runoff surface at
  // each station. Multiple bands can be active at once (a curb with a runoff
  // behind it) and abutting intervals on the same side each ship their own
  // mesh. Rather than preferring one band and snapping to its vertices — which
  // leaves a notch wherever two intervals meet or a single row falls between
  // them — take the band outer vertex that lies farthest from the centerline
  // across every band touching this station. Farthest-wins yields one
  // continuous boundary that abutting seams share instead of cutting into each
  // other.
  const center = { x: section.center.x, z: section.center.y };
  let best: TerrainVertex | null = null;
  let bestDistance = -Infinity;

  for (const band of [...surface.runoffs, ...surface.curbs]) {
    if (band.side !== side) {
      continue;
    }
    const row = band.rowMetadata.findIndex((entry) => Math.abs(entry.station - station) <= 1e-4);
    if (row < 0) {
      continue;
    }
    const column = band.columnCount - 1;
    const index = (row * band.columnCount + column) * 3;
    const vertex: TerrainVertex = {
      x: band.positions[index],
      y: band.positions[index + 1],
      z: band.positions[index + 2],
      station,
    };
    const distance = Math.hypot(vertex.x - center.x, vertex.z - center.z);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = vertex;
    }
  }

  return best;
}

function hasZeroLengthBoundaryEdges(vertices: readonly TerrainVertex[]): boolean {
  for (let index = 1; index < vertices.length; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
    if (distance <= 1e-6) {
      return true;
    }
  }
  return false;
}

function matchingOpposite(side: 'left' | 'right', station: number, boundary: CorridorBoundary): TerrainVertex {
  const source = side === 'left' ? boundary.right : boundary.left;
  return source.reduce((best, candidate) =>
    Math.abs(candidate.station - station) < Math.abs(best.station - station) ? candidate : best,
  );
}

// Whether the corridor loop's boundary advances opposite to the orientation the
// skirt's per-side winding is authored for, in which case both sides must flip
// to stay front-facing. The baseline (unflipped) orientation is the one the
// default loops use — a positive X/Z shoelace area of the left boundary ring —
// so the reversed (negative-area) winding is the one that needs flipping. Open
// corridors do not wrap, so they keep the baseline convention.
function isClockwiseCorridor(boundary: CorridorBoundary): boolean {
  if (!boundary.closed) {
    return false;
  }
  const ring = boundary.left;
  if (ring.length < 3) {
    return false;
  }
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += current.x * next.z - next.x * current.z;
  }
  return area > 0;
}

function outwardDirection(
  side: 'left' | 'right',
  source: readonly TerrainVertex[],
  station: number,
  boundary: CorridorBoundary,
): TerrainPoint {
  const current = source[station];
  const previous = source[Math.max(station - 1, 0)];
  const next = source[Math.min(station + 1, source.length - 1)];
  const tangent = normalize2({ x: next.x - previous.x, z: next.z - previous.z });
  const sign = side === 'left' ? 1 : -1;
  const perpendicular = { x: -tangent.z * sign, z: tangent.x * sign };

  if (Number.isFinite(perpendicular.x) && Number.isFinite(perpendicular.z) && Math.hypot(perpendicular.x, perpendicular.z) > 0.5) {
    const opposite = matchingOpposite(side, current.station, boundary);
    const toOpposite = normalize2({ x: opposite.x - current.x, z: opposite.z - current.z });
    if (perpendicular.x * toOpposite.x + perpendicular.z * toOpposite.z > 0) {
      return { x: -perpendicular.x, z: -perpendicular.z };
    }
    return perpendicular;
  }

  const opposite = matchingOpposite(side, current.station, boundary);
  return normalize2({ x: current.x - opposite.x, z: current.z - opposite.z });
}

function computeSkirtNormals(
  positions: Float32Array,
  indices: readonly number[],
  normals: Float32Array,
) {
  for (let i = 1; i < normals.length; i += 3) {
    normals[i - 1] = 0;
    normals[i] = 0;
    normals[i + 1] = 0;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax;
    const by = positions[b * 3 + 1] - ay;
    const bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax;
    const cy = positions[c * 3 + 1] - ay;
    const cz = positions[c * 3 + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    normals[a * 3] += nx;
    normals[a * 3 + 1] += ny;
    normals[a * 3 + 2] += nz;
    normals[b * 3] += nx;
    normals[b * 3 + 1] += ny;
    normals[b * 3 + 2] += nz;
    normals[c * 3] += nx;
    normals[c * 3 + 1] += ny;
    normals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const length = Math.hypot(x, y, z);
    if (length > 1e-9) {
      // The skirt/pillar/portal aprons are upward-facing ground geometry, but
      // the triangle winding that feeds these normals depends on the corridor
      // boundary's loop orientation (the compiler flips the frame to match the
      // polygon winding). That made every skirt normal come out pointing DOWN,
      // rendering the seam unlit/upside-down. Orient toward +Y so the result is
      // independent of winding — correct for any near-horizontal apron.
      const sign = y < 0 ? -1 : 1;
      normals[i] = (x / length) * sign;
      normals[i + 1] = (y / length) * sign;
      normals[i + 2] = (z / length) * sign;
    } else {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
  }
}

function cellIndex(document: TerrainDocument, cell: TerrainCell): number {
  return cell.row * document.resolution.columns + cell.column;
}

function writeTerrainNormals(document: TerrainDocument, normals: Float32Array) {
  const { columns, rows } = document.resolution;
  const xStep = document.size.width / Math.max(columns - 1, 1);
  const zStep = document.size.depth / Math.max(rows - 1, 1);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = document.heights[cellIndex(document, { column: Math.max(column - 1, 0), row })] ?? 0;
      const right = document.heights[cellIndex(document, { column: Math.min(column + 1, columns - 1), row })] ?? 0;
      const down = document.heights[cellIndex(document, { column, row: Math.max(row - 1, 0) })] ?? 0;
      const up = document.heights[cellIndex(document, { column, row: Math.min(row + 1, rows - 1) })] ?? 0;
      const normal = normalize3({
        x: -(right - left) / Math.max(xStep * 2, 1e-9),
        y: 1,
        z: -(up - down) / Math.max(zStep * 2, 1e-9),
      });
      const index = cellIndex(document, { column, row }) * 3;
      normals[index] = normal.x;
      normals[index + 1] = normal.y;
      normals[index + 2] = normal.z;
    }
  }
}

function smoothTerrain(
  document: TerrainDocument,
  point: TerrainPoint,
  settings: TerrainBrushSettings,
): TerrainDocument {
  const heights = [...document.heights];
  const radius = Math.max(settings.radius, 0);
  forEachBrushCell(document, point, radius, (index, distance, cell) => {
    if (document.masks[index] !== 'free') {
      return;
    }

    const average = averageNeighborHeight(document, cell);
    const weight = falloffWeight(distance / radius, settings.falloff);
    heights[index] = lerp(heights[index] ?? 0, average, clamp01(settings.strength * weight));
  });
  return { ...document, heights };
}

function forEachBrushCell(
  document: TerrainDocument,
  point: TerrainPoint,
  radius: number,
  callback: (index: number, distance: number, cell: TerrainCell) => void,
) {
  const center = worldToCell(document, point);
  const xStep = document.size.width / Math.max(document.resolution.columns - 1, 1);
  const zStep = document.size.depth / Math.max(document.resolution.rows - 1, 1);
  const columnRadius = Math.ceil(radius / Math.max(xStep, 1e-9));
  const rowRadius = Math.ceil(radius / Math.max(zStep, 1e-9));
  const minColumn = clamp(center.column - columnRadius, 0, document.resolution.columns - 1);
  const maxColumn = clamp(center.column + columnRadius, 0, document.resolution.columns - 1);
  const minRow = clamp(center.row - rowRadius, 0, document.resolution.rows - 1);
  const maxRow = clamp(center.row + rowRadius, 0, document.resolution.rows - 1);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const world = cellToWorld(document, { column, row });
      const distance = Math.hypot(world.x - point.x, world.z - point.z);
      if (distance <= radius) {
        callback(cellIndex(document, { column, row }), distance, { column, row });
      }
    }
  }
}

function averageNeighborHeight(document: TerrainDocument, cell: TerrainCell): number {
  let total = 0;
  let count = 0;
  for (let row = cell.row - 1; row <= cell.row + 1; row += 1) {
    for (let column = cell.column - 1; column <= cell.column + 1; column += 1) {
      if (
        column < 0 ||
        row < 0 ||
        column >= document.resolution.columns ||
        row >= document.resolution.rows
      ) {
        continue;
      }
      total += document.heights[cellIndex(document, { column, row })] ?? 0;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

function normalizeArray<T>(value: readonly T[] | undefined, length: number, fallback: T): T[] {
  return Array.from({ length }, (_, index) => value?.[index] ?? fallback);
}


function distanceToPolyline(point: TerrainPoint, polyline: readonly TerrainPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length; index += 1) {
    const a = polyline[index];
    const b = polyline[(index + 1) % polyline.length];
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(point: TerrainPoint, a: TerrainPoint, b: TerrainPoint): number {
  const ab = { x: b.x - a.x, z: b.z - a.z };
  const ap = { x: point.x - a.x, z: point.z - a.z };
  const lengthSq = ab.x * ab.x + ab.z * ab.z;
  const t = lengthSq <= 1e-9 ? 0 : clamp((ap.x * ab.x + ap.z * ab.z) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + ab.x * t), point.z - (a.z + ab.z * t));
}

function normalize2(vector: TerrainPoint): TerrainPoint {
  const magnitude = Math.hypot(vector.x, vector.z);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return { x: 1, z: 0 };
  }
  return { x: vector.x / magnitude, z: vector.z / magnitude };
}

function normalize3(vector: { readonly x: number; readonly y: number; readonly z: number }) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return { x: 0, y: 1, z: 0 };
  }
  return { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude };
}

function falloffWeight(value: number, falloff: TerrainBrushFalloff): number {
  const t = clamp01(value);
  if (falloff === 'constant') {
    return 1;
  }
  if (falloff === 'smooth') {
    const smooth = t * t * (3 - 2 * t);
    return 1 - smooth;
  }
  return 1 - t;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function materialColor(material: string): { readonly r: number; readonly g: number; readonly b: number } {
  if (material === 'gravel') {
    return { r: 0.42, g: 0.47, b: 0.48 };
  }
  if (material === 'dirt') {
    return { r: 0.38, g: 0.26, b: 0.14 };
  }
  if (material === 'debug') {
    return { r: 0.95, g: 0.86, b: 0.2 };
  }
  return { r: 0.09, g: 0.22, b: 0.14 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(value), min), max);
}
