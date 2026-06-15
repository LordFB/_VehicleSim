import type { SurfaceMaterial, VehicleSpec, WorldSpec } from '../types';

const WHEEL_IDS = new Set(['frontLeft', 'frontRight', 'rearLeft', 'rearRight']);

export function validateWorldSpec(spec: WorldSpec): WorldSpec {
  if (!Number.isFinite(spec.gravity) || spec.gravity <= 0) {
    throw new Error('World gravity must be a positive finite number.');
  }
  if (!spec.materials.some((material) => material.id === spec.defaultMaterialId)) {
    throw new Error(`Default material ${spec.defaultMaterialId} is not present in world materials.`);
  }
  const ids = new Set<string>();
  for (const material of spec.materials) validateMaterial(material, ids);
  for (const zone of spec.zones) {
    if (!ids.has(zone.materialId)) throw new Error(`Zone ${zone.id} references missing material ${zone.materialId}.`);
  }
  for (const layer of spec.meshSurface?.layers ?? []) {
    if (!ids.has(layer.materialId)) throw new Error(`Mesh surface layer ${layer.id} references missing material ${layer.materialId}.`);
    if (layer.positions.length % 3 !== 0) throw new Error(`Mesh surface layer ${layer.id} positions must be xyz triples.`);
    if (layer.normals && layer.normals.length !== layer.positions.length) {
      throw new Error(`Mesh surface layer ${layer.id} normals must match positions.`);
    }
    if (layer.indices.length % 3 !== 0) throw new Error(`Mesh surface layer ${layer.id} indices must be triangles.`);
    for (const value of layer.positions) {
      if (!Number.isFinite(value)) throw new Error(`Mesh surface layer ${layer.id} has non-finite positions.`);
    }
    for (const index of layer.indices) {
      if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= layer.positions.length) {
        throw new Error(`Mesh surface layer ${layer.id} has an out-of-range index.`);
      }
    }
  }
  return spec;
}

function validateMaterial(material: SurfaceMaterial, ids: Set<string>): void {
  if (ids.has(material.id)) throw new Error(`Duplicate surface material ${material.id}.`);
  ids.add(material.id);
  for (const key of ['muLongitudinal', 'muLateral', 'roughness', 'wetness', 'temperatureC', 'rubberLevel', 'rollingResistance'] as const) {
    if (!Number.isFinite(material[key])) throw new Error(`Material ${material.id} has invalid ${key}.`);
  }
}

export function validateVehicleSpec(spec: VehicleSpec): VehicleSpec {
  if (!spec.name) throw new Error('Vehicle must have a name.');
  if (!Number.isFinite(spec.chassis.mass) || spec.chassis.mass <= 0) throw new Error('Chassis mass must be positive.');
  if (spec.wheels.length !== 4) throw new Error('The vertical slice requires exactly four wheels.');
  const ids = new Set<string>();
  for (const wheel of spec.wheels) {
    if (!WHEEL_IDS.has(wheel.id)) throw new Error(`Unknown wheel id ${wheel.id}.`);
    if (ids.has(wheel.id)) throw new Error(`Duplicate wheel id ${wheel.id}.`);
    ids.add(wheel.id);
    if (wheel.tire.radius <= 0 || wheel.inertia <= 0) throw new Error(`Wheel ${wheel.id} has invalid tire radius or inertia.`);
    if (wheel.suspension.restLength <= 0 || wheel.suspension.springRate <= 0) {
      throw new Error(`Wheel ${wheel.id} has invalid suspension data.`);
    }
  }
  if (spec.engine.idleRpm <= 0 || spec.engine.redlineRpm <= spec.engine.idleRpm) {
    throw new Error('Engine RPM limits are invalid.');
  }
  if (!spec.drivetrain.gearRatios.length) throw new Error('At least one gear ratio is required.');
  return spec;
}
