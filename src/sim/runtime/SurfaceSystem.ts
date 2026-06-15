import type { SurfaceContact, SurfaceMaterial, SurfaceMaterialId, SurfaceZoneSpec, TerrainTrackSample, TerrainTrackSpec, Vec3Tuple, WorldSpec } from '../types';
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

  constructor(world: WorldSpec) {
    for (const material of world.materials) this.materials.set(material.id, material);
    this.zones = world.zones;
    this.defaultMaterialId = world.defaultMaterialId;
    this.terrainTrack = world.terrainTrack;
    this.terrainCellSize = Math.max(8, (world.terrainTrack?.halfWidth ?? 4) * 4);
    if (this.terrainTrack) this.buildTerrainGrid(this.terrainTrack.samples);
  }

  query(point: Vec3 | Vec3Tuple): SurfaceContact {
    const p = Array.isArray(point) ? Vec3.fromTuple(point) : point;
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
    const terrain = this.queryTerrain(x, Infinity, z);
    if (terrain) return terrain.point[1];
    return this.findZone(x, z)?.heightOffset ?? 0;
  }

  private queryTerrain(x: number, y: number, z: number): SurfaceContact | null {
    const track = this.terrainTrack;
    if (!track || track.samples.length === 0) return null;
    const nearest = this.nearestTerrainSample(x, z);
    if (!nearest) return null;
    const { sample } = nearest;
    const dx = x - sample.pos[0];
    const dz = z - sample.pos[1];
    const longitudinal = dx * sample.tangent[0] + dz * sample.tangent[1];
    const lateral = dx * sample.left[0] + dz * sample.left[1];
    const width = track.halfWidth;
    const shoulder = track.shoulderWidth;
    if (Math.abs(lateral) > TERRAIN_CORRIDOR_HALF_WIDTH) return null;

    const height = terrainSurfaceHeight(sample, lateral, width, shoulder, x, z, longitudinal);
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
