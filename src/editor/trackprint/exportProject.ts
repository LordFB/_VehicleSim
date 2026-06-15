import type { CompileResult } from '@trackprint/track-compiler';
import type { TrackDocument } from '@trackprint/track-core';
import type { SkirtMeshData, TerrainMeshData } from '@trackprint/terrain-core';
import { compileProjectHash, createProject } from './project';

export interface ExportSettings {
  readonly includeTerrain: boolean;
  readonly includeCollision: boolean;
  readonly includeDebug: boolean;
  readonly coordinateSystem: 'y-up' | 'z-up';
  readonly unitScale: number;
}

export interface ExportManifest {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly sourceHash: string;
  };
  readonly settings: ExportSettings;
  readonly meshes: readonly ExportMeshRecord[];
  readonly materials: readonly string[];
  readonly sectors: readonly { readonly id: string; readonly name: string; readonly startStation: number; readonly endStation: number }[];
  readonly timingLineStation: number;
  readonly surfaceRegions: readonly string[];
}

export interface ExportMeshRecord {
  readonly id: string;
  readonly material: string;
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly collision: boolean;
  readonly bounds: readonly [number, number, number, number, number, number];
}

export interface ExportPackage {
  readonly manifest: ExportManifest;
  readonly glbBytes: Uint8Array;
  readonly stats: ExportPreviewStats;
}

export interface ExportPreviewStats {
  readonly meshCount: number;
  readonly materialCount: number;
  readonly vertexCount: number;
  readonly bounds: readonly [number, number, number, number, number, number];
}

export const defaultExportSettings: ExportSettings = {
  includeTerrain: true,
  includeCollision: true,
  includeDebug: false,
  coordinateSystem: 'y-up',
  unitScale: 1,
};

export function exportProject(
  track: TrackDocument,
  surface: CompileResult,
  terrainMesh: TerrainMeshData,
  skirtMesh: SkirtMeshData,
  settings: ExportSettings,
): ExportPackage {
  const project = createProject(track, {
    id: 'export-terrain',
    version: 1,
    origin: { x: 0, z: 0 },
    size: { width: 1, depth: 1 },
    resolution: { columns: 1, rows: 1 },
    heights: [0],
    materials: ['grass'],
    masks: ['free'],
    brushStrokes: [],
  });
  const meshes: ExportMeshRecord[] = [
    meshRecord('asphalt', 'asphalt', surface.asphalt.positions, surface.asphalt.indices, false),
    ...surface.curbs.map((curb) => meshRecord(`curb:${curb.intervalId}`, 'curb', curb.positions, curb.indices, false)),
    ...surface.runoffs.map((runoff) => meshRecord(`runoff:${runoff.intervalId}`, 'runoff', runoff.positions, runoff.indices, false)),
    meshRecord('skirt', 'skirt', skirtMesh.positions, skirtMesh.indices, false),
  ];
  if (settings.includeTerrain) {
    meshes.push(meshRecord('terrain', 'terrain', terrainMesh.positions, terrainMesh.indices, false));
  }
  if (settings.includeCollision) {
    meshes.push(meshRecord('collision:asphalt', 'collision', surface.asphalt.positions, surface.asphalt.indices, true));
  }

  const manifest: ExportManifest = {
    project: {
      id: track.id,
      name: track.id,
      sourceHash: compileProjectHash({ ...project, track }),
    },
    settings,
    meshes,
    materials: [...new Set(meshes.map((mesh) => mesh.material))].sort(),
    sectors: (track.sectors ?? []).map((sector) => ({
      id: sector.id,
      name: sector.name,
      startStation: sector.startStation,
      endStation: sector.endStation,
    })),
    timingLineStation: 0,
    surfaceRegions: ['asphalt', 'curb', 'runoff', 'outside'],
  };
  const stats = previewStats(manifest);
  return {
    manifest,
    glbBytes: encodeGlbLike(manifest),
    stats,
  };
}

export function reloadExportPreview(glbBytes: Uint8Array): ExportPreviewStats {
  const manifest = decodeGlbLike(glbBytes);
  return previewStats(manifest);
}

function meshRecord(
  id: string,
  material: string,
  positions: Float32Array,
  indices: Uint32Array,
  collision: boolean,
): ExportMeshRecord {
  return {
    id,
    material,
    vertexCount: positions.length / 3,
    indexCount: indices.length,
    collision,
    bounds: boundsForPositions(positions),
  };
}

function previewStats(manifest: ExportManifest): ExportPreviewStats {
  return {
    meshCount: manifest.meshes.length,
    materialCount: manifest.materials.length,
    vertexCount: manifest.meshes.reduce((total, mesh) => total + mesh.vertexCount, 0),
    bounds: mergeBounds(manifest.meshes.map((mesh) => mesh.bounds)),
  };
}

function encodeGlbLike(manifest: ExportManifest): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  bytes.fill(0x20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}

function decodeGlbLike(bytes: Uint8Array): ExportManifest {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Export preview is not a TrackPrint GLB payload.');
  }
  const jsonLength = view.getUint32(12, true);
  const json = new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)).trim();
  return JSON.parse(json) as ExportManifest;
}

function boundsForPositions(positions: Float32Array): readonly [number, number, number, number, number, number] {
  const bounds: [number, number, number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let index = 0; index < positions.length; index += 3) {
    bounds[0] = Math.min(bounds[0], positions[index]);
    bounds[1] = Math.min(bounds[1], positions[index + 1]);
    bounds[2] = Math.min(bounds[2], positions[index + 2]);
    bounds[3] = Math.max(bounds[3], positions[index]);
    bounds[4] = Math.max(bounds[4], positions[index + 1]);
    bounds[5] = Math.max(bounds[5], positions[index + 2]);
  }
  return bounds.map((value) => (Number.isFinite(value) ? value : 0)) as unknown as readonly [number, number, number, number, number, number];
}

function mergeBounds(allBounds: readonly (readonly [number, number, number, number, number, number])[]): readonly [number, number, number, number, number, number] {
  return allBounds.reduce(
    (merged, bounds) => [
      Math.min(merged[0], bounds[0]),
      Math.min(merged[1], bounds[1]),
      Math.min(merged[2], bounds[2]),
      Math.max(merged[3], bounds[3]),
      Math.max(merged[4], bounds[4]),
      Math.max(merged[5], bounds[5]),
    ],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ).map((value) => (Number.isFinite(value) ? value : 0)) as unknown as readonly [number, number, number, number, number, number];
}
