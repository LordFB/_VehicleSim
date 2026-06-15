import type {
  MeshSurfaceLayerSpec,
  MeshSurfaceSpec,
  SurfaceContact,
  SurfaceMaterial,
  SurfaceMaterialId,
  SurfaceZoneSpec,
  TerrainTrackSample,
  TerrainTrackSpec,
  Vec3Tuple,
  WorldSpec,
} from '../types';
import { Vec3 } from '../math/Vec3';
import {
  TERRAIN_CORRIDOR_HALF_WIDTH,
  terrainSurfaceHeight,
  terrainSurfaceMaterial,
  terrainSurfaceNormal,
} from './TerrainSurface';

export class SurfaceSystem {
  private readonly materials = new Map<SurfaceMaterialId, SurfaceMaterial>();
  private readonly zones: SurfaceZoneSpec[];
  private readonly defaultMaterialId: SurfaceMaterialId;
  private readonly terrainTrack?: TerrainTrackSpec;
  private readonly terrainGrid = new Map<string, number[]>();
  private readonly terrainCellSize: number;
  private readonly meshSurface?: MeshSurfaceIndex;

  constructor(world: WorldSpec) {
    for (const material of world.materials) this.materials.set(material.id, material);
    this.zones = world.zones;
    this.defaultMaterialId = world.defaultMaterialId;
    this.terrainTrack = world.terrainTrack;
    this.terrainCellSize = Math.max(8, (world.terrainTrack?.halfWidth ?? 4) * 4);
    if (this.terrainTrack) this.buildTerrainGrid(this.terrainTrack.samples);
    this.meshSurface = world.meshSurface ? buildMeshSurfaceIndex(world.meshSurface) : undefined;
  }

  query(point: Vec3 | Vec3Tuple): SurfaceContact {
    const p = Array.isArray(point) ? Vec3.fromTuple(point) : point;
    const meshContact = this.queryMeshSurface(p.x, p.y, p.z);
    if (meshContact) return meshContact;
    const terrainContact = this.queryTerrain(p.x, p.y, p.z);
    if (terrainContact) return terrainContact;
    const zone = this.findZone(p.x, p.z);
    const materialId = zone?.materialId ?? this.defaultMaterialId;
    const material = this.materials.get(materialId);
    if (!material) throw new Error(`Missing material ${materialId}.`);
    const height = zone?.heightOffset ?? 0;

    return {
      point: [p.x, height, p.z],
      normal: [0, 1, 0],
      depth: Math.max(0, height - p.y),
      materialId,
      muLongitudinal: material.muLongitudinal,
      muLateral: material.muLateral,
      roughness: material.roughness,
      wetness: material.wetness,
      temperatureC: material.temperatureC,
      rubberLevel: material.rubberLevel,
      gravelDepth: materialId === 'gravel' ? 0.035 : 0,
    };
  }

  heightAt(x: number, z: number): number {
    const mesh = this.queryMeshSurface(x, Infinity, z);
    if (mesh) return mesh.point[1];
    const terrain = this.queryTerrain(x, Infinity, z);
    if (terrain) return terrain.point[1];
    return this.findZone(x, z)?.heightOffset ?? 0;
  }

  private queryTerrain(x: number, y: number, z: number): SurfaceContact | null {
    const track = this.terrainTrack;
    if (!track || track.samples.length === 0) return null;
    const nearest = this.nearestTerrainSegment(x, z);
    if (!nearest) return null;
    const { sample } = nearest;
    const dx = x - sample.pos[0];
    const dz = z - sample.pos[1];
    const lateral = dx * sample.left[0] + dz * sample.left[1];
    const width = track.halfWidth;
    const shoulder = track.shoulderWidth;
    if (Math.abs(lateral) > TERRAIN_CORRIDOR_HALF_WIDTH) return null;

    const height = terrainSurfaceHeight(sample, lateral, width, shoulder, x, z, 0);
    const normal = terrainSurfaceNormal(sample, lateral, width, shoulder, x, z);
    const materialId = terrainSurfaceMaterial(sample, lateral, width, shoulder);
    const material = this.materials.get(materialId);
    if (!material) throw new Error(`Missing material ${materialId}.`);
    return {
      point: [x, height, z],
      normal,
      depth: Math.max(0, height - y),
      materialId,
      muLongitudinal: material.muLongitudinal,
      muLateral: material.muLateral,
      roughness: material.roughness,
      wetness: material.wetness,
      temperatureC: material.temperatureC,
      rubberLevel: material.rubberLevel,
      gravelDepth: materialId === 'gravel' ? 0.03 : 0,
    };
  }

  private queryMeshSurface(x: number, y: number, z: number): SurfaceContact | null {
    const surface = this.meshSurface;
    if (!surface) return null;
    const candidates = surface.buckets.get(meshKey(x, z, surface.cellSize));
    if (!candidates || candidates.length === 0) return null;

    let best: MeshTriangle | null = null;
    let bestHeight = -Infinity;
    let bestPriority = Infinity;
    for (const triangle of candidates) {
      if (
        x < triangle.minX - 1e-5 ||
        x > triangle.maxX + 1e-5 ||
        z < triangle.minZ - 1e-5 ||
        z > triangle.maxZ + 1e-5
      ) {
        continue;
      }
      const bary = barycentricXZ(triangle, x, z);
      if (!bary) continue;
      const height = triangle.ay * bary.a + triangle.by * bary.b + triangle.cy * bary.c;
      if (triangle.priority < bestPriority || (triangle.priority === bestPriority && height > bestHeight)) {
        best = triangle;
        bestHeight = height;
        bestPriority = triangle.priority;
      }
    }
    if (!best) return null;

    const material = this.materials.get(best.materialId);
    if (!material) throw new Error(`Missing material ${best.materialId}.`);
    return {
      point: [x, bestHeight, z],
      normal: best.normal,
      depth: Math.max(0, bestHeight - y),
      materialId: best.materialId,
      muLongitudinal: material.muLongitudinal,
      muLateral: material.muLateral,
      roughness: material.roughness,
      wetness: material.wetness,
      temperatureC: material.temperatureC,
      rubberLevel: material.rubberLevel,
      gravelDepth: best.materialId === 'gravel' ? 0.03 : 0,
    };
  }

  private buildTerrainGrid(samples: TerrainTrackSample[]): void {
    for (let i = 0; i < samples.length; i += 1) {
      const p = samples[i];
      const key = this.terrainKey(p.pos[0], p.pos[1]);
      const bucket = this.terrainGrid.get(key) ?? [];
      bucket.push(i);
      this.terrainGrid.set(key, bucket);
    }
  }

  private nearestTerrainSample(x: number, z: number): { sample: TerrainTrackSample; distanceSq: number } | null {
    const samples = this.terrainTrack?.samples;
    if (!samples) return null;
    let best: TerrainTrackSample | null = null;
    let bestD = Infinity;
    const cx = Math.floor(x / this.terrainCellSize);
    const cz = Math.floor(z / this.terrainCellSize);
    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = this.terrainGrid.get(`${cx + ox},${cz + oz}`);
        if (!bucket) continue;
        for (const index of bucket) {
          const p = samples[index];
          const dx = x - p.pos[0];
          const dz = z - p.pos[1];
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    if (best) return { sample: best, distanceSq: bestD };
    for (const p of samples) {
      const dx = x - p.pos[0];
      const dz = z - p.pos[1];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { sample: best, distanceSq: bestD } : null;
  }

  private nearestTerrainSegment(x: number, z: number): { sample: TerrainTrackSample; distanceSq: number } | null {
    const samples = this.terrainTrack?.samples;
    if (!samples || samples.length === 0) return null;
    if (samples.length === 1) return this.nearestTerrainSample(x, z);

    let best: { sample: TerrainTrackSample; distanceSq: number } | null = null;
    const seen = new Set<number>();
    const cx = Math.floor(x / this.terrainCellSize);
    const cz = Math.floor(z / this.terrainCellSize);
    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = this.terrainGrid.get(`${cx + ox},${cz + oz}`);
        if (!bucket) continue;
        for (const index of bucket) {
          this.considerTerrainSegment(samples, index, x, z, seen, (candidate) => {
            if (!best || candidate.distanceSq < best.distanceSq) best = candidate;
          });
          this.considerTerrainSegment(samples, index - 1, x, z, seen, (candidate) => {
            if (!best || candidate.distanceSq < best.distanceSq) best = candidate;
          });
        }
      }
    }

    if (best) return best;
    for (let i = 0; i < samples.length; i += 1) {
      this.considerTerrainSegment(samples, i, x, z, seen, (candidate) => {
        if (!best || candidate.distanceSq < best.distanceSq) best = candidate;
      });
    }
    return best;
  }

  private considerTerrainSegment(
    samples: TerrainTrackSample[],
    rawIndex: number,
    x: number,
    z: number,
    seen: Set<number>,
    accept: (candidate: { sample: TerrainTrackSample; distanceSq: number }) => void,
  ): void {
    const count = samples.length;
    const index = ((rawIndex % count) + count) % count;
    if (seen.has(index)) return;
    seen.add(index);
    const a = samples[index];
    const b = samples[(index + 1) % count];
    const abx = b.pos[0] - a.pos[0];
    const abz = b.pos[1] - a.pos[1];
    const lengthSq = abx * abx + abz * abz;
    if (lengthSq <= 1e-9) return;
    const t = Math.max(0, Math.min(1, ((x - a.pos[0]) * abx + (z - a.pos[1]) * abz) / lengthSq));
    const px = a.pos[0] + abx * t;
    const pz = a.pos[1] + abz * t;
    const dx = x - px;
    const dz = z - pz;
    const tangent = normalize2(abx, abz, a.tangent);
    const left = normalize2(
      a.left[0] + (b.left[0] - a.left[0]) * t,
      a.left[1] + (b.left[1] - a.left[1]) * t,
      [-tangent[1], tangent[0]],
    );
    accept({
      distanceSq: dx * dx + dz * dz,
      sample: {
        pos: [px, pz],
        tangent,
        left,
        normal: normalize3(
          a.normal[0] + (b.normal[0] - a.normal[0]) * t,
          a.normal[1] + (b.normal[1] - a.normal[1]) * t,
          a.normal[2] + (b.normal[2] - a.normal[2]) * t,
        ),
        curvature: a.curvature + (b.curvature - a.curvature) * t,
        s: a.s + (b.s - a.s) * t,
        realS: a.realS !== undefined && b.realS !== undefined ? a.realS + (b.realS - a.realS) * t : undefined,
        elevation: a.elevation + (b.elevation - a.elevation) * t,
        camber: a.camber + (b.camber - a.camber) * t,
        sector: a.sector,
      },
    });
  }

  private terrainKey(x: number, z: number): string {
    return `${Math.floor(x / this.terrainCellSize)},${Math.floor(z / this.terrainCellSize)}`;
  }

  private findZone(x: number, z: number): SurfaceZoneSpec | undefined {
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const zone = this.zones[i];
      const dx = x - zone.center[0];
      const dz = z - zone.center[1];
      if (zone.type === 'rect' && zone.size) {
        if (Math.abs(dx) <= zone.size[0] * 0.5 && Math.abs(dz) <= zone.size[1] * 0.5) return zone;
      }
      if (zone.type === 'circle' && zone.radius !== undefined) {
        if (dx * dx + dz * dz <= zone.radius * zone.radius) return zone;
      }
      if (zone.type === 'ring' && zone.radius !== undefined && zone.innerRadius !== undefined) {
        const distSq = dx * dx + dz * dz;
        if (distSq <= zone.radius * zone.radius && distSq >= zone.innerRadius * zone.innerRadius) return zone;
      }
    }
    return undefined;
  }
}

function normalize2(x: number, z: number, fallback: [number, number]): [number, number] {
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length <= 1e-9) return fallback;
  return [x / length, z / length];
}

function normalize3(x: number, y: number, z: number): Vec3Tuple {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 1e-9) return [0, 1, 0];
  return [x / length, y / length, z / length];
}

type MeshTriangle = {
  materialId: SurfaceMaterialId;
  priority: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  normal: Vec3Tuple;
};

type MeshSurfaceIndex = {
  cellSize: number;
  buckets: Map<string, MeshTriangle[]>;
};

function buildMeshSurfaceIndex(surface: MeshSurfaceSpec): MeshSurfaceIndex {
  const cellSize = Math.max(1, surface.cellSize ?? 8);
  const buckets = new Map<string, MeshTriangle[]>();
  surface.layers.forEach((layer, priority) => {
    for (let i = 0; i < layer.indices.length; i += 3) {
      const triangle = makeMeshTriangle(layer, i, priority);
      if (!triangle) continue;
      const minCellX = Math.floor(triangle.minX / cellSize);
      const maxCellX = Math.floor(triangle.maxX / cellSize);
      const minCellZ = Math.floor(triangle.minZ / cellSize);
      const maxCellZ = Math.floor(triangle.maxZ / cellSize);
      for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
        for (let cx = minCellX; cx <= maxCellX; cx += 1) {
          const key = `${cx},${cz}`;
          const bucket = buckets.get(key) ?? [];
          bucket.push(triangle);
          buckets.set(key, bucket);
        }
      }
    }
  });
  return { cellSize, buckets };
}

function makeMeshTriangle(layer: MeshSurfaceLayerSpec, indexOffset: number, priority: number): MeshTriangle | null {
  const ia = layer.indices[indexOffset] * 3;
  const ib = layer.indices[indexOffset + 1] * 3;
  const ic = layer.indices[indexOffset + 2] * 3;
  const ax = layer.positions[ia];
  const ay = layer.positions[ia + 1];
  const az = layer.positions[ia + 2];
  const bx = layer.positions[ib];
  const by = layer.positions[ib + 1];
  const bz = layer.positions[ib + 2];
  const cx = layer.positions[ic];
  const cy = layer.positions[ic + 1];
  const cz = layer.positions[ic + 2];
  const projectedArea = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (Math.abs(projectedArea) <= 1e-8) return null;
  const normal = layer.normals
    ? normalize3(
        layer.normals[ia] + layer.normals[ib] + layer.normals[ic],
        layer.normals[ia + 1] + layer.normals[ib + 1] + layer.normals[ic + 1],
        layer.normals[ia + 2] + layer.normals[ib + 2] + layer.normals[ic + 2],
      )
    : triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
  return {
    materialId: layer.materialId,
    priority,
    ax,
    ay,
    az,
    bx,
    by,
    bz,
    cx,
    cy,
    cz,
    minX: Math.min(ax, bx, cx),
    maxX: Math.max(ax, bx, cx),
    minZ: Math.min(az, bz, cz),
    maxZ: Math.max(az, bz, cz),
    normal: normal[1] < 0 ? [-normal[0], -normal[1], -normal[2]] : normal,
  };
}

function barycentricXZ(triangle: MeshTriangle, x: number, z: number): { a: number; b: number; c: number } | null {
  const v0x = triangle.bx - triangle.ax;
  const v0z = triangle.bz - triangle.az;
  const v1x = triangle.cx - triangle.ax;
  const v1z = triangle.cz - triangle.az;
  const v2x = x - triangle.ax;
  const v2z = z - triangle.az;
  const denom = v0x * v1z - v1x * v0z;
  if (Math.abs(denom) <= 1e-8) return null;
  const b = (v2x * v1z - v1x * v2z) / denom;
  const c = (v0x * v2z - v2x * v0z) / denom;
  const a = 1 - b - c;
  const eps = -1e-4;
  return a >= eps && b >= eps && c >= eps ? { a, b, c } : null;
}

function triangleNormal(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): Vec3Tuple {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  return normalize3(
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  );
}

function meshKey(x: number, z: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
}
