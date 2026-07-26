import elevationRaw from './monzaElevation.json';
import { MONZA_SCALE } from './MonzaTrack';
import type { MonzaOpenTopoProfile } from './TrackDefinition';

type RawProfile = {
  source: string;
  fetched: string;
  controls: Array<{ realS: number; elevation: number }>;
};

const RAW = elevationRaw as RawProfile;
const controls = RAW.controls.slice().sort((a, b) => a.realS - b.realS);
const minElevation = controls.reduce((min, c) => Math.min(min, c.elevation), Number.POSITIVE_INFINITY);
const baseElevationMeters = Number.isFinite(minElevation) ? minElevation : 0;

export const MONZA_OPEN_TOPO_PROFILE: MonzaOpenTopoProfile = {
  source: RAW.source,
  fetched: RAW.fetched,
  baseElevationMeters,
  scale: MONZA_SCALE,
  controls,
};

export function monzaElevationAtRealS(realS: number): number {
  if (controls.length === 0) return 0;
  const lap = controls[controls.length - 1].realS || realS;
  const wrapped = ((realS % lap) + lap) % lap;
  let weighted = 0;
  let weights = 0;
  // SRTMGL1 is coarse for a racetrack; use it as macro terrain, not a road scan.
  // A broad Gaussian removes raster cell stair-steps that would feel like false bumps.
  const sigma = 460;
  for (const control of controls) {
    const d0 = Math.abs(wrapped - control.realS);
    const d = Math.min(d0, lap - d0);
    const w = Math.exp(-(d * d) / (2 * sigma * sigma));
    weighted += control.elevation * w;
    weights += w;
  }
  const elevation = weights > 1e-6 ? weighted / weights : controls[0].elevation;
  return (elevation - baseElevationMeters) * MONZA_SCALE;
}

export function normalFromGrade(tangent: [number, number], grade: number): [number, number, number] {
  const nx = -tangent[0] * grade;
  const nz = -tangent[1] * grade;
  const inv = 1 / Math.hypot(nx, 1, nz);
  return [nx * inv, inv, nz * inv];
}
