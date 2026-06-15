import monzaFeatures from './monzaFeatures.json';
import { buildMonzaWorld, monzaCheckpoints, monzaTrackPath } from './MonzaWorld';
import { centerlineBounds, centerlineLength, TRACK_HALF_WIDTH } from './MonzaTrack';
import { buildNordschleifeTrack } from './NordschleifeWorld';
import {
  loadTrackPrintPreviewTrack,
  loadTrackPrintPreviewTrackForBrowser,
  type TrackPrintPreviewStorage,
} from './trackprintPreviewStorage';
import type { TrackDefinition } from './TrackDefinition';
import type { BankingSpec } from './LevelBuilder';
import type { TerrainTrackSample } from '../sim/types';

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
  const line = monza.centerline.map<TerrainTrackSample>((p) => ({
    pos: p.pos,
    tangent: p.tangent,
    left: p.left,
    normal: [0, 1, 0],
    curvature: p.curvature,
    s: p.s,
    realS: p.s / 0.5,
    elevation: 0,
    camber: 0,
    sector: 'Monza',
  }));
  const bounds = centerlineBounds(monza.centerline);
  const spawn = { position: [0, 0.72, 0] as [number, number, number], yawRad: 0 };
  const world = { ...monza.world, spawn };
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
    },
    metadata: {
      realLengthMeters: centerlineLength(monza.centerline) / 0.5,
      scale: 0.5,
      scaledTrackHalfWidth: TRACK_HALF_WIDTH,
    },
  };
}
