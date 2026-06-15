import { compileTrackSurface, sampleTrackSurface, type CompileResult } from '@trackprint/track-compiler';
import { createStationLookup, repairTrackContinuity, type TrackDocument } from '@trackprint/track-core';
import baseWorld from '../../sim/data/testWorld.json';
import type { TrackDefinition, TrackId } from '../../level/TrackDefinition';
import type { SerializableTrackPrintSurface, SerializableTrackPrintTerrainMesh } from '../../level/TrackDefinition';
import type { MeshSurfaceSpec, SurfaceMaterialId, TerrainTrackSample, Vec3Tuple, WorldSpec } from '../../sim/types';

export type VehicleSimTrackPrintExportOptions = {
  id?: Extract<TrackId, 'trackprint'>;
  displayName?: string;
  rowCount?: number;
  targetSpacingMeters?: number;
  maxSamples?: number;
  elevationSmoothingMeters?: number;
  camberSmoothingMeters?: number;
  shoulderWidth?: number;
  checkpointCount?: number;
};

export function createVehicleSimTrackFromTrackPrint(
  sourceDocument: TrackDocument,
  options: VehicleSimTrackPrintExportOptions = {},
): TrackDefinition {
  const document = repairTrackContinuity(sourceDocument);
  const lookup = createStationLookup(document, 256);
  const sourceRows = options.rowCount ?? Math.min(options.maxSamples ?? 24000, Math.max(1024, Math.ceil(lookup.totalLength / 0.75)));
  const surface = compileTrackSurface(document, lookup, sourceRows);
  const centerline = resampleAsQuadRows(surface, options);

  if (centerline.length < 2) {
    throw new Error('TrackPrint document must compile to at least two centerline samples.');
  }

  const bounds = boundsOf(centerline);
  const start = centerline[0];
  const headingRad = Math.atan2(start.tangent[0], start.tangent[1]);
  const halfWidth = Math.max(
    ...surface.crossSections.map((section) => Math.max(section.leftWidth, section.rightWidth)),
    6,
  );
  const shoulderWidth = options.shoulderWidth ?? 4;
  const spawn = {
    position: [start.pos[0], start.elevation + 0.72, start.pos[1]] as Vec3Tuple,
    yawRad: headingRad,
  };
  const world: WorldSpec = {
    gravity: baseWorld.gravity,
    defaultMaterialId: 'grass',
    materials: createTrackPrintSurfaceMaterials(baseWorld.materials as WorldSpec['materials']),
    zones: [
      {
        id: `${document.id}_grass_base`,
        materialId: 'grass',
        type: 'rect',
        center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
        size: [bounds.maxX - bounds.minX + halfWidth * 8, bounds.maxZ - bounds.minZ + halfWidth * 8],
        heightOffset: -0.08,
      },
    ],
    barriers: [],
    terrainTrack: {
      samples: centerline,
      halfWidth,
      shoulderWidth,
    },
    spawn,
  };

  return {
    id: options.id ?? 'trackprint',
    displayName: options.displayName ?? displayNameForTrackPrint(document.id),
    world,
    startFinish: {
      center: [start.pos[0] + start.tangent[0] * 6, start.pos[1] + start.tangent[1] * 6],
      width: halfWidth * 2 + 0.8,
      depth: 1.4,
      headingRad,
    },
    spawn,
    centerline,
    trackPath: [...centerline.map((p) => p.pos), centerline[0].pos],
    checkpoints: checkpoints(centerline, options.checkpointCount ?? 10, halfWidth),
    bounds,
    features: {
      generatedGround: false,
      generatedTerrain: false,
      generatedKerbs: false,
      generatedScenery: false,
      textureStyle: 'trackprint',
    },
    metadata: {
      realLengthMeters: surface.totalLength,
      scale: 1,
      scaledTrackHalfWidth: halfWidth,
      scaledShoulderWidth: shoulderWidth,
    },
  };
}

type TrackPrintMeshSource = {
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly normals?: ArrayLike<number>;
  readonly uvs?: ArrayLike<number>;
};

export function serializeTrackPrintTerrainMesh(mesh: TrackPrintMeshSource): SerializableTrackPrintTerrainMesh {
  return {
    positions: Array.from(mesh.positions, compactFloat),
    indices: Array.from(mesh.indices),
    ...(mesh.normals ? { normals: Array.from(mesh.normals, compactFloat) } : {}),
    ...(mesh.uvs ? { uvs: Array.from(mesh.uvs, compactFloat) } : {}),
  };
}

export function serializeTrackPrintSurface(surface: CompileResult): SerializableTrackPrintSurface {
  return {
    asphalt: serializeTrackPrintTerrainMesh(surface.asphalt),
    bands: [
      ...surface.curbs.map((curb) => ({
        ...serializeTrackPrintTerrainMesh(curb),
        material: curb.side === 'left' ? 'curbLeft' as const : 'curbRight' as const,
      })),
      ...surface.runoffs.map((runoff) => ({
        ...serializeTrackPrintTerrainMesh(runoff),
        material: runoff.side === 'left' ? 'runoffLeft' as const : 'runoffRight' as const,
      })),
    ],
  };
}

export function serializeTrackPrintCollisionSurface(
  surface: CompileResult,
  terrain: TrackPrintMeshSource,
  skirt: TrackPrintMeshSource,
): MeshSurfaceSpec {
  return {
    cellSize: 8,
    layers: [
      meshLayer('trackprint-asphalt', 'asphalt_new', surface.asphalt),
      ...surface.curbs.map((curb) => meshLayer(`trackprint-curb-${curb.side}`, 'kerb', curb)),
      ...surface.runoffs.map((runoff) => meshLayer(`trackprint-runoff-${runoff.side}`, 'gravel', runoff)),
      meshLayer('trackprint-terrain', 'grass', terrain),
      meshLayer('trackprint-skirt', 'grass', skirt),
    ].filter((layer) => layer.positions.length > 0 && layer.indices.length > 0),
  };
}

function meshLayer(id: string, materialId: SurfaceMaterialId, mesh: TrackPrintMeshSource): MeshSurfaceSpec['layers'][number] {
  const serialized = serializeTrackPrintTerrainMesh(mesh);
  return {
    id,
    materialId,
    positions: serialized.positions,
    indices: serialized.indices,
    ...(serialized.normals ? { normals: serialized.normals } : {}),
  };
}

function compactFloat(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function createTrackPrintSurfaceMaterials(materials: WorldSpec['materials']): WorldSpec['materials'] {
  return materials.map((material) => {
    if (material.id !== 'asphalt_new') return material;
    return {
      ...material,
      muLongitudinal: 1.55,
      muLateral: 1.48,
      roughness: 0.22,
      temperatureC: 82,
      rubberLevel: 0.9,
    };
  });
}

function resampleAsQuadRows(
  surface: ReturnType<typeof compileTrackSurface>,
  options: VehicleSimTrackPrintExportOptions,
): TerrainTrackSample[] {
  const totalLength = surface.totalLength;
  const targetSpacing = Math.max(0.25, options.targetSpacingMeters ?? 0.75);
  const maxSamples = Math.max(64, options.maxSamples ?? 24000);
  const count = Math.max(64, Math.min(maxSamples, Math.ceil(totalLength / targetSpacing)));
  const spacing = totalLength / count;
  const rows: TerrainTrackSample[] = [];

  for (let i = 0; i < count; i += 1) {
    const station = i * spacing;
    const center = sampleTrackSurface(surface, station, 0);
    const before = sampleTrackSurface(surface, station - spacing * 0.5, 0);
    const after = sampleTrackSurface(surface, station + spacing * 0.5, 0);
    const tangent = normalized2(after.position.x - before.position.x, after.position.z - before.position.z);
    const left = normalized2(-tangent[1], tangent[0]);
    rows.push({
      pos: [center.position.x, center.position.z],
      tangent,
      left,
      normal: normalized3(center.normal.x, center.normal.y, center.normal.z),
      curvature: curvatureAt(surface, station, spacing),
      s: station,
      realS: station,
      elevation: center.position.y,
      camber: center.banking,
      sector: activeSectorAt(surface, station),
    });
  }

  return smoothSurfaceRows(rows, spacing, {
    elevationMeters: options.elevationSmoothingMeters ?? 24,
    camberMeters: options.camberSmoothingMeters ?? 36,
  });
}

function curvatureAt(surface: ReturnType<typeof compileTrackSurface>, station: number, spacing: number): number {
  const a = sampleTrackSurface(surface, station - spacing, 0);
  const b = sampleTrackSurface(surface, station, 0);
  const c = sampleTrackSurface(surface, station + spacing, 0);
  const ab = normalized2(b.position.x - a.position.x, b.position.z - a.position.z);
  const bc = normalized2(c.position.x - b.position.x, c.position.z - b.position.z);
  const cross = ab[0] * bc[1] - ab[1] * bc[0];
  const dot = Math.min(Math.max(ab[0] * bc[0] + ab[1] * bc[1], -1), 1);
  const turn = Math.atan2(cross, dot);
  return turn / Math.max(spacing, 1e-6);
}

function activeSectorAt(surface: ReturnType<typeof compileTrackSurface>, station: number): string | undefined {
  let best = surface.crossSections[0];
  let bestDistance = Infinity;
  for (const section of surface.crossSections) {
    const distance = Math.abs(section.station - station);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = section;
    }
  }
  return best?.activeIntervalIds[0];
}

function smoothSurfaceRows(
  rows: TerrainTrackSample[],
  spacing: number,
  options: { elevationMeters: number; camberMeters: number },
): TerrainTrackSample[] {
  const elevations = smoothCircular(rows.map((row) => row.elevation), Math.ceil(options.elevationMeters / spacing));
  const cambers = smoothCircular(rows.map((row) => row.camber), Math.ceil(options.camberMeters / spacing));
  const out = rows.map<TerrainTrackSample>((row, index) => ({
    ...row,
    elevation: elevations[index],
    camber: clamp(cambers[index], -0.08, 0.08),
  }));

  for (let i = 0; i < out.length; i += 1) {
    const prev = out[(i - 1 + out.length) % out.length];
    const next = out[(i + 1) % out.length];
    const ds = Math.max(next.s - prev.s > 0 ? next.s - prev.s : spacing * 2, spacing * 2);
    const grade = (next.elevation - prev.elevation) / ds;
    const camber = out[i].camber;
    const tangent = out[i].tangent;
    const left = out[i].left;
    out[i] = {
      ...out[i],
      normal: normalized3(
        -tangent[0] * grade - left[0] * Math.tan(camber),
        1,
        -tangent[1] * grade - left[1] * Math.tan(camber),
      ),
    };
  }

  return out;
}

function smoothCircular(values: number[], radius: number): number[] {
  if (values.length === 0 || radius <= 0) return values;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let weighted = 0;
    let totalWeight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = (i + offset + values.length) % values.length;
      const weight = 1 - Math.abs(offset) / (radius + 1);
      weighted += values[index] * weight;
      totalWeight += weight;
    }
    out[i] = weighted / totalWeight;
  }
  return out;
}

function normalized2(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return [1, 0];
  }
  return [x / length, z / length];
}

function normalized3(x: number, y: number, z: number): Vec3Tuple {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return [0, 1, 0];
  }
  return [x / length, y / length, z / length];
}

function boundsOf(samples: TerrainTrackSample[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sample of samples) {
    minX = Math.min(minX, sample.pos[0]);
    maxX = Math.max(maxX, sample.pos[0]);
    minZ = Math.min(minZ, sample.pos[1]);
    maxZ = Math.max(maxZ, sample.pos[1]);
  }
  return { minX, maxX, minZ, maxZ };
}

function checkpoints(
  samples: TerrainTrackSample[],
  requestedCount: number,
  halfWidth: number,
): Array<{ x: number; z: number; radius: number }> {
  const count = Math.max(1, Math.floor(requestedCount));
  const out: Array<{ x: number; z: number; radius: number }> = [];
  for (let i = 1; i <= count; i += 1) {
    const index = Math.floor((i / (count + 1)) * (samples.length - 1));
    const p = samples[index];
    out.push({ x: p.pos[0], z: p.pos[1], radius: halfWidth + 7 });
  }
  return out;
}

function displayNameForTrackPrint(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'TrackPrint Course';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
