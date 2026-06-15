import type { TerrainTrackSample, Vec3Tuple, WorldSpec } from '../sim/types';
import type { BankingSpec, StartFinishLine } from './LevelBuilder';
import type { ForestMass, TrackBounds } from '../render/Scenery';

export type TrackId = 'monza' | 'nordschleife' | 'trackprint';

export type TrackCenterlinePoint = TerrainTrackSample;

export type TrackLandmark = {
  name: string;
  position: Vec3Tuple;
  yawRad: number;
};

export type TrackFeatures = {
  banking?: BankingSpec;
  forests?: ForestMass[];
  landmarks?: TrackLandmark[];
  generatedGround?: boolean;
  generatedTerrain?: boolean;
  generatedKerbs?: boolean;
  generatedScenery?: boolean;
  textureStyle?: 'vehicle-sim' | 'trackprint';
  trackPrintTerrain?: SerializableTrackPrintTerrainMesh;
  trackPrintSkirt?: SerializableTrackPrintTerrainMesh;
  trackPrintSurface?: SerializableTrackPrintSurface;
};

export type SerializableTrackPrintTerrainMesh = {
  positions: number[];
  indices: number[];
  normals?: number[];
  uvs?: number[];
  colors?: number[];
};

export type SerializableTrackPrintSurfaceBand = SerializableTrackPrintTerrainMesh & {
  material: 'asphalt' | 'curbLeft' | 'curbRight' | 'runoffLeft' | 'runoffRight';
};

export type SerializableTrackPrintSurface = {
  asphalt: SerializableTrackPrintTerrainMesh;
  bands: SerializableTrackPrintSurfaceBand[];
};

export type TrackDefinition = {
  id: TrackId;
  displayName: string;
  world: WorldSpec;
  startFinish: StartFinishLine;
  spawn: {
    position: Vec3Tuple;
    yawRad: number;
  };
  centerline: TrackCenterlinePoint[];
  trackPath: Array<[number, number]>;
  checkpoints: Array<{ x: number; z: number; radius: number }>;
  bounds: TrackBounds;
  features: TrackFeatures;
  metadata: {
    realLengthMeters: number;
    scale: number;
    scaledTrackHalfWidth: number;
    scaledShoulderWidth?: number;
  };
};
