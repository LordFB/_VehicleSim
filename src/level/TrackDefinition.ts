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

export type TreeSpeciesSpec = {
  id: string;
  label: string;
  weight: number;
  minHeight: number;
  maxHeight: number;
  canopyColor: number;
  highlightColor: number;
  trunkColor: number;
  crownWidth: number;
};

export type MonzaDetailPolyline = {
  name: string;
  points: Array<[number, number]>;
  width?: number;
};

export type MonzaDetailBox = {
  name: string;
  center: Vec3Tuple;
  size: Vec3Tuple;
  yawRad: number;
  color?: number;
};

export type MonzaPaintedRunoff = {
  name: string;
  center: [number, number];
  size: [number, number];
  yawRad: number;
  color: 'green' | 'white' | 'red';
};

export type MonzaBrakingBoard = {
  label: string;
  position: Vec3Tuple;
  yawRad: number;
};

export type MonzaOpenTopoProfile = {
  source: string;
  fetched: string;
  baseElevationMeters: number;
  scale: number;
  controls: Array<{ realS: number; elevation: number }>;
};

export type MonzaDetailSpec = {
  treeSpecies: TreeSpeciesSpec[];
  serviceRoads: MonzaDetailPolyline[];
  fenceRuns: MonzaDetailPolyline[];
  builtAreas: MonzaDetailBox[];
  paintedRunoffs: MonzaPaintedRunoff[];
  brakingBoards: MonzaBrakingBoard[];
  openTopo: MonzaOpenTopoProfile;
};

export type TrackFeatures = {
  banking?: BankingSpec;
  forests?: ForestMass[];
  landmarks?: TrackLandmark[];
  monzaDetail?: MonzaDetailSpec;
  generatedGround?: boolean;
  generatedTerrain?: boolean;
  generatedKerbs?: boolean;
  generatedScenery?: boolean;
  textureStyle?: 'vehicle-sim' | 'trackprint';
  trackPrintTerrain?: SerializableTrackPrintTerrainMesh;
  trackPrintSkirt?: SerializableTrackPrintTerrainMesh;
  trackPrintSurface?: SerializableTrackPrintSurface;
  trackPrintTerrainTexture?: SerializableTrackPrintTerrainTexture;
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

export type SerializableTrackPrintTerrainTexture = {
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
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
