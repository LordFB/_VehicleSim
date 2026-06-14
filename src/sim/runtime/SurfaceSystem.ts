import type { SurfaceContact, SurfaceMaterial, SurfaceMaterialId, SurfaceZoneSpec, Vec3Tuple, WorldSpec } from '../types';
import { Vec3 } from '../math/Vec3';

export class SurfaceSystem {
  private readonly materials = new Map<SurfaceMaterialId, SurfaceMaterial>();
  private readonly zones: SurfaceZoneSpec[];
  private readonly defaultMaterialId: SurfaceMaterialId;

  constructor(world: WorldSpec) {
    for (const material of world.materials) this.materials.set(material.id, material);
    this.zones = world.zones;
    this.defaultMaterialId = world.defaultMaterialId;
  }

  query(point: Vec3 | Vec3Tuple): SurfaceContact {
    const p = Array.isArray(point) ? Vec3.fromTuple(point) : point;
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
    return this.findZone(x, z)?.heightOffset ?? 0;
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
