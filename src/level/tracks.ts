import monzaFeatures from './monzaFeatures.json';
import { buildMonzaWorld, monzaCheckpoints, monzaTrackPath } from './MonzaWorld';
import { centerlineBounds, centerlineLength, TRACK_HALF_WIDTH } from './MonzaTrack';
import { buildMonzaDetail } from './MonzaDetail';
import { monzaElevationAtRealS, normalFromGrade } from './MonzaElevation';
import { buildNordschleifeTrack } from './NordschleifeWorld';
import {
  loadTrackPrintPreviewTrack,
  loadTrackPrintPreviewTrackForBrowser,
  type TrackPrintPreviewStorage,
} from './trackprintPreviewStorage';
import type { TrackDefinition } from './TrackDefinition';
import type { BankingSpec } from './LevelBuilder';
import type { BarrierSpec, TerrainTrackSample } from '../sim/types';

export function getTrackDefinition(params: URLSearchParams, trackPrintStorage?: TrackPrintPreviewStorage): TrackDefinition {
  const requested = params.get('track')?.toLowerCase();
  if (requested === 'nordschleife' || requested === 'nord') return buildNordschleifeTrack();
  if (requested === 'trackprint' || requested === 'trackprint-preview') {
    const preview = loadTrackPrintPreviewTrack(trackPrintStorage);
    if (preview) return preview;
  }
  return buildMonzaTrack();
}

export async function getTrackDefinitionForBrowser(params: URLSearchParams): Promise<TrackDefinition> {
  const requested = params.get('track')?.toLowerCase();
  if (requested === 'trackprint' || requested === 'trackprint-preview') {
    const preview = await loadTrackPrintPreviewTrackForBrowser();
    if (preview) return preview;
  }
  return getTrackDefinition(params);
}

export function buildMonzaTrack(): TrackDefinition {
  const monza = buildMonzaWorld();
  const sampledElevations = monza.centerline.map((p) => monzaElevationAtRealS(p.s / 0.5));
  const minSampledElevation = Math.min(...sampledElevations);
  const elevations = sampledElevations.map((elevation) => elevation - minSampledElevation);
  const line = monza.centerline.map<TerrainTrackSample>((p, i) => {
    const prev = monza.centerline[(i - 1 + monza.centerline.length) % monza.centerline.length];
    const next = monza.centerline[(i + 1) % monza.centerline.length];
    const prevElevation = elevations[(i - 1 + elevations.length) % elevations.length];
    const nextElevation = elevations[(i + 1) % elevations.length];
    const ds = Math.max(1e-4, Math.hypot(next.pos[0] - prev.pos[0], next.pos[1] - prev.pos[1]));
    const grade = (nextElevation - prevElevation) / ds;
    return {
      pos: p.pos,
      tangent: p.tangent,
      left: p.left,
      normal: normalFromGrade(p.tangent, grade),
      curvature: p.curvature,
      s: p.s,
      realS: p.s / 0.5,
      elevation: elevations[i],
      camber: 0,
      sector: 'Monza',
    };
  });
  const bounds = centerlineBounds(monza.centerline);
  const spawn = { position: [0, line[0].elevation + 0.72, 0] as [number, number, number], yawRad: 0 };
  const world = {
    ...monza.world,
    barriers: elevateBarriers(monza.world.barriers, line),
    spawn,
    terrainTrack: {
      samples: line,
      halfWidth: TRACK_HALF_WIDTH,
      shoulderWidth: 1.8,
    },
  };
  return {
    id: 'monza',
    displayName: 'Autodromo Nazionale Monza',
    world,
    startFinish: monza.startFinish,
    spawn,
    centerline: line,
    trackPath: monzaTrackPath(monza.centerline),
    checkpoints: monzaCheckpoints(monza.centerline),
    bounds,
    features: {
      banking: monzaFeatures.banking as unknown as BankingSpec,
      forests: monzaFeatures.forests,
      monzaDetail: buildMonzaDetail(line),
    },
    metadata: {
      realLengthMeters: centerlineLength(monza.centerline) / 0.5,
      scale: 0.5,
      scaledTrackHalfWidth: TRACK_HALF_WIDTH,
    },
  };
}

function elevateBarriers(barriers: BarrierSpec[], samples: TerrainTrackSample[]): BarrierSpec[] {
  return barriers.map((barrier) => {
    const nearest = nearestSample(samples, barrier.center[0], barrier.center[2]);
    return {
      ...barrier,
      center: [barrier.center[0], nearest.elevation + barrier.halfExtents[1], barrier.center[2]],
    };
  });
}

function nearestSample(samples: TerrainTrackSample[], x: number, z: number): TerrainTrackSample {
  let best = samples[0];
  let bestD = Infinity;
  for (const sample of samples) {
    const dx = x - sample.pos[0];
    const dz = z - sample.pos[1];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = sample;
      bestD = d;
    }
  }
  return best;
}
