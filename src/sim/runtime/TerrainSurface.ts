import type { SurfaceMaterialId, TerrainTrackSample, Vec3Tuple } from '../types';

export const TERRAIN_CORRIDOR_HALF_WIDTH = 120;

export function roadSurfaceHeight(sample: TerrainTrackSample, lateral: number, halfWidth: number): number {
  const camber = clamp(sample.camber, -0.18, 0.18);
  const crown = Math.max(0, 1 - Math.abs(lateral) / halfWidth) * 0.028;
  const edgeDrop = smoothstep(halfWidth * 0.84, halfWidth, Math.abs(lateral)) * -0.018;
  return sample.elevation + lateral * Math.tan(camber) + crown + edgeDrop;
}

export function terrainSurfaceHeight(
  sample: TerrainTrackSample,
  lateral: number,
  halfWidth: number,
  shoulderWidth: number,
  x: number,
  z: number,
  longitudinal = 0,
): number {
  const abs = Math.abs(lateral);
  const side = Math.sign(lateral) || 1;
  const slopeLong = normalToLongitudinalSlope(sample.normal, sample.tangent);
  const roadHeight = roadSurfaceHeight(sample, clamp(lateral, -halfWidth, halfWidth), halfWidth) + longitudinal * slopeLong;
  const edgeHeight = roadSurfaceHeight(sample, side * halfWidth, halfWidth) + longitudinal * slopeLong;

  if (abs <= halfWidth) return roadHeight;

  const shoulderT = smoothstep(halfWidth, halfWidth + shoulderWidth, abs);
  if (abs <= halfWidth + shoulderWidth + 0.1) {
    return edgeHeight - 0.035 - shoulderT * 0.09 + terrainNoise(x, z, 10) * 0.025;
  }

  const distance = abs - halfWidth - shoulderWidth;
  const roll = terrainNoise(x, z, 56) * 0.9 + terrainNoise(x + 19, z - 7, 17) * 0.22;
  const embankment = -0.12 - distance * 0.0045;
  return edgeHeight + embankment + roll * smoothstep(0, 55, distance);
}

export function terrainSurfaceNormal(
  sample: TerrainTrackSample,
  lateral: number,
  halfWidth: number,
  shoulderWidth: number,
  x: number,
  z: number,
): Vec3Tuple {
  if (Math.abs(lateral) <= halfWidth + 0.2) return sample.normal;
  const step = 0.8;
  const hx0 = terrainSurfaceHeight(sample, lateral - step, halfWidth, shoulderWidth, x - sample.left[0] * step, z - sample.left[1] * step);
  const hx1 = terrainSurfaceHeight(sample, lateral + step, halfWidth, shoulderWidth, x + sample.left[0] * step, z + sample.left[1] * step);
  const lateralSlope = (hx1 - hx0) / (step * 2);
  const longSlope = normalToLongitudinalSlope(sample.normal, sample.tangent) * smoothstep(halfWidth, TERRAIN_CORRIDOR_HALF_WIDTH, Math.abs(lateral));
  const nx = -sample.left[0] * lateralSlope - sample.tangent[0] * longSlope;
  const nz = -sample.left[1] * lateralSlope - sample.tangent[1] * longSlope;
  const invLen = 1 / Math.hypot(nx, 1, nz);
  return [nx * invLen, invLen, nz * invLen];
}

export function terrainSurfaceMaterial(
  sample: TerrainTrackSample,
  lateral: number,
  halfWidth: number,
  shoulderWidth: number,
): SurfaceMaterialId {
  const absLat = Math.abs(lateral);
  if (absLat <= halfWidth - 0.25) {
    if ((sample.sector === 'Karussell' || sample.sector === 'Schwalbenschwanz') && absLat > halfWidth * 0.35) return 'kerb';
    return 'asphalt_new';
  }
  if (absLat <= halfWidth + 0.35) return 'kerb';
  if (absLat <= halfWidth + shoulderWidth) return sample.curvature > 0.035 ? 'gravel' : 'grass';
  return 'grass';
}

export function terrainNoise(x: number, z: number, scale: number): number {
  return (
    Math.sin(x / scale + z * 0.031) * 0.5 +
    Math.sin(z / (scale * 0.73) - x * 0.019) * 0.35 +
    Math.sin((x + z) / (scale * 1.9)) * 0.15
  );
}

export function normalToLongitudinalSlope(normal: Vec3Tuple, tangent: [number, number]): number {
  const ny = Math.max(0.1, normal[1]);
  return -(normal[0] * tangent[0] + normal[2] * tangent[1]) / ny;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
