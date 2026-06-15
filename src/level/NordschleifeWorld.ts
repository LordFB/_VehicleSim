import dataRaw from './nordschleifeData.json';
import baseWorld from '../sim/data/testWorld.json';
import type { BarrierSpec, TerrainTrackSample, WorldSpec } from '../sim/types';
import type { TrackDefinition, TrackLandmark } from './TrackDefinition';

type NordschleifeData = {
  metadata: {
    realLengthMeters: number;
    scale: number;
    scaledTrackHalfWidth: number;
    scaledShoulderWidth: number;
  };
  samples: TerrainTrackSample[];
  landmarks: Array<{ name: string; realS: number }>;
};

const data = dataRaw as unknown as NordschleifeData;

export function buildNordschleifeTrack(): TrackDefinition {
  const samples = data.samples;
  const bounds = boundsOf(samples);
  const start = samples[0];
  const spawn = {
    position: [start.pos[0], start.elevation + 0.72, start.pos[1]] as [number, number, number],
    yawRad: Math.atan2(start.tangent[0], start.tangent[1]),
  };
  const world: WorldSpec = {
    gravity: baseWorld.gravity,
    defaultMaterialId: 'grass',
    materials: baseWorld.materials as WorldSpec['materials'],
    zones: [
      {
        id: 'nord_grass_base',
        materialId: 'grass',
        type: 'rect',
        center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
        size: [bounds.maxX - bounds.minX + 260, bounds.maxZ - bounds.minZ + 260],
        heightOffset: -0.08,
      },
    ],
    barriers: buildBarriers(samples),
    terrainTrack: {
      samples,
      halfWidth: data.metadata.scaledTrackHalfWidth,
      shoulderWidth: data.metadata.scaledShoulderWidth,
    },
    spawn,
  };

  return {
    id: 'nordschleife',
    displayName: 'Nurburgring Nordschleife',
    world,
    startFinish: {
      center: [start.pos[0] + start.tangent[0] * 6, start.pos[1] + start.tangent[1] * 6],
      width: data.metadata.scaledTrackHalfWidth * 2 + 0.8,
      depth: 1.4,
      headingRad: Math.atan2(start.tangent[0], start.tangent[1]),
    },
    spawn,
    centerline: samples,
    trackPath: samples.map((p) => p.pos),
    checkpoints: checkpoints(samples),
    bounds,
    features: {
      forests: forestMasses(bounds, samples),
      landmarks: landmarkSigns(samples),
    },
    metadata: data.metadata,
  };
}

export function nearestNordschleifeSample(
  samples: TerrainTrackSample[],
  x: number,
  z: number,
): { sample: TerrainTrackSample; index: number; distanceSq: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const p = samples[i];
    const dx = x - p.pos[0];
    const dz = z - p.pos[1];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { sample: samples[best], index: best, distanceSq: bestD };
}

function boundsOf(samples: TerrainTrackSample[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of samples) {
    minX = Math.min(minX, p.pos[0]);
    maxX = Math.max(maxX, p.pos[0]);
    minZ = Math.min(minZ, p.pos[1]);
    maxZ = Math.max(maxZ, p.pos[1]);
  }
  return { minX, maxX, minZ, maxZ };
}

function buildBarriers(samples: TerrainTrackSample[]): BarrierSpec[] {
  const barriers: BarrierSpec[] = [];
  const halfWidth = data.metadata.scaledTrackHalfWidth;
  const off = halfWidth + 1.45;
  const maxSpan = 1.6;
  let n = 0;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    const dx = b.pos[0] - a.pos[0];
    const dz = b.pos[1] - a.pos[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const spans = Math.max(1, Math.ceil(length / maxSpan));
    for (const side of [-1, 1] as const) {
      for (let j = 0; j < spans; j += 1) {
        const start = edgePoint(a, b, j / spans, side, off);
        const end = edgePoint(a, b, (j + 1) / spans, side, off);
        const sx = end.x - start.x;
        const sz = end.z - start.z;
        const spanLength = Math.hypot(sx, sz);
        if (spanLength < 0.01) continue;
        barriers.push({
          id: `nord_guard_${i}_${side === 1 ? 'left' : 'right'}_${j}_${n++}`,
          center: [
            (start.x + end.x) * 0.5,
            (start.y + end.y) * 0.5 + 0.45,
            (start.z + end.z) * 0.5,
          ],
          halfExtents: [0.16, 0.45, spanLength * 0.5 + 0.08],
          yawRad: Math.atan2(sx / spanLength, sz / spanLength),
        });
      }
    }
  }
  return barriers;
}

function edgePoint(
  a: TerrainTrackSample,
  b: TerrainTrackSample,
  t: number,
  side: -1 | 1,
  offset: number,
): { x: number; y: number; z: number } {
  const x = a.pos[0] + (b.pos[0] - a.pos[0]) * t;
  const z = a.pos[1] + (b.pos[1] - a.pos[1]) * t;
  const y = a.elevation + (b.elevation - a.elevation) * t;
  const lx = a.left[0] + (b.left[0] - a.left[0]) * t;
  const lz = a.left[1] + (b.left[1] - a.left[1]) * t;
  const len = Math.hypot(lx, lz) || 1;
  return {
    x: x + (lx / len) * offset * side,
    y,
    z: z + (lz / len) * offset * side,
  };
}

function checkpoints(samples: TerrainTrackSample[]): Array<{ x: number; z: number; radius: number }> {
  const out: Array<{ x: number; z: number; radius: number }> = [];
  const count = 18;
  for (let i = 1; i <= count; i += 1) {
    const idx = Math.floor((i / (count + 1)) * (samples.length - 1));
    const p = samples[idx];
    out.push({ x: p.pos[0], z: p.pos[1], radius: data.metadata.scaledTrackHalfWidth + 7 });
  }
  return out;
}

function landmarkSigns(samples: TerrainTrackSample[]): TrackLandmark[] {
  return data.landmarks.map((mark) => {
    const p = nearestByRealS(samples, mark.realS);
    const side = p.curvature < 0 ? 1 : -1;
    const off = data.metadata.scaledTrackHalfWidth + 3.8;
    return {
      name: mark.name,
      position: [
        p.pos[0] + p.left[0] * off * side,
        p.elevation + 1.4,
        p.pos[1] + p.left[1] * off * side,
      ],
      yawRad: Math.atan2(p.tangent[0], p.tangent[1]),
    };
  });
}

function nearestByRealS(samples: TerrainTrackSample[], realS: number): TerrainTrackSample {
  let best = samples[0];
  let bestD = Infinity;
  for (const sample of samples) {
    const d = Math.abs((sample.realS ?? sample.s / data.metadata.scale) - realS);
    if (d < bestD) {
      bestD = d;
      best = sample;
    }
  }
  return best;
}

function forestMasses(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  samples: TerrainTrackSample[],
): Array<{ cx: number; cz: number; hx: number; hz: number }> {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;
  const masses = [
    { cx: cx - w * 0.28, cz: cz - h * 0.28, hx: w * 0.18, hz: h * 0.2 },
    { cx: cx + w * 0.26, cz: cz - h * 0.18, hx: w * 0.2, hz: h * 0.18 },
    { cx: cx + w * 0.22, cz: cz + h * 0.26, hx: w * 0.18, hz: h * 0.2 },
    { cx: cx - w * 0.22, cz: cz + h * 0.22, hx: w * 0.18, hz: h * 0.17 },
  ];
  // Keep one broad mass around the long Dottinger side so the horizon reads forested.
  const dottinger = samples[Math.floor(samples.length * 0.97)];
  masses.push({ cx: dottinger.pos[0], cz: dottinger.pos[1] - 120, hx: w * 0.16, hz: h * 0.11 });
  return masses;
}
