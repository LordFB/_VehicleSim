import { compileTrackSurface } from '@trackprint/track-compiler';
import {
  createStationLookup,
  validateCurbs,
  validateRunoffs,
  validateSectors,
  validateTrackWidth,
  type TrackDocument,
} from '@trackprint/track-core';
import {
  createTerrainDocument,
  deserializeTerrainDocument,
  type TerrainDocument,
} from '@trackprint/terrain-core';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';

export interface TrackPrintProject {
  readonly id: string;
  readonly version: 1;
  readonly metadata: {
    readonly name: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly track: TrackDocument;
  readonly terrain: TerrainDocument;
  readonly editorState: {
    readonly selectedPoint: string | null;
    readonly mode: EditorMode;
  };
}

export type EditorMode = 'track' | 'terrain' | 'drive' | 'analysis' | 'export';

export interface ProjectValidationIssue {
  readonly code: string;
  readonly message: string;
}

export function createProject(
  track: TrackDocument,
  terrain: TerrainDocument,
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly selectedPoint?: string | null;
    readonly mode?: EditorMode;
  } = {},
): TrackPrintProject {
  const now = new Date(0).toISOString();
  return {
    id: options.id ?? 'trackprint-project',
    version: 1,
    metadata: {
      name: options.name ?? 'Untitled Track',
      createdAt: now,
      updatedAt: now,
    },
    track,
    terrain,
    editorState: {
      selectedPoint: options.selectedPoint ?? null,
      mode: options.mode ?? 'track',
    },
  };
}

export function serializeProject(project: TrackPrintProject): string {
  return stableStringify(project);
}

export function loadProject(serialized: string): { readonly project?: TrackPrintProject; readonly issues: ProjectValidationIssue[] } {
  try {
    const migrated = migrateProject(JSON.parse(serialized));
    const issues = validateProject(migrated);
    return { project: migrated, issues };
  } catch (error) {
    return {
      issues: [
        {
          code: 'project-json',
          message: error instanceof Error ? error.message : 'Project JSON could not be parsed.',
        },
      ],
    };
  }
}

export function migrateProject(value: unknown): TrackPrintProject {
  if (isRecord(value) && value.version === 1) {
    return value as unknown as TrackPrintProject;
  }

  if (isRecord(value) && 'track' in value) {
    return createProject(
      value.track as TrackDocument,
      isRecord(value.terrain) ? normalizeTerrain(value.terrain) : createTerrainDocument(),
      {
        id: typeof value.id === 'string' ? value.id : 'migrated-project',
        name: isRecord(value.metadata) && typeof value.metadata.name === 'string' ? value.metadata.name : 'Migrated Track',
      },
    );
  }

  throw new Error('Project is missing a track document.');
}

export function validateProject(project: TrackPrintProject): ProjectValidationIssue[] {
  const issues: ProjectValidationIssue[] = [];
  if (!project.id) {
    issues.push({ code: 'project-id', message: 'Project ID is required.' });
  }
  if (project.version !== 1) {
    issues.push({ code: 'project-version', message: 'Unsupported project version.' });
  }
  if (!project.track || !Array.isArray(project.track.segments)) {
    issues.push({ code: 'project-track', message: 'Project track section is invalid.' });
    return issues;
  }
  if (!project.terrain || !project.terrain.resolution) {
    issues.push({ code: 'project-terrain', message: 'Project terrain section is invalid.' });
    return issues;
  }

  const lookup = createStationLookup(project.track, 32);
  issues.push(
    ...validateTrackWidth(project.track, lookup).map((issue) => ({ code: 'track-width', message: issue.message })),
    ...validateSectors(project.track, lookup).map((issue) => ({ code: 'track-sector', message: issue.message })),
    ...validateCurbs(project.track, lookup).map((issue) => ({ code: 'track-curb', message: issue.message })),
    ...validateRunoffs(project.track, lookup).map((issue) => ({ code: 'track-runoff', message: issue.message })),
  );

  const cellCount = project.terrain.resolution.columns * project.terrain.resolution.rows;
  if (project.terrain.heights.length !== cellCount || project.terrain.materials.length !== cellCount) {
    issues.push({ code: 'terrain-cells', message: 'Terrain height/material arrays must match terrain resolution.' });
  }
  if (project.terrain.brushStrokes.some((stroke) => !stroke.id || !Number.isFinite(stroke.timestamp))) {
    issues.push({ code: 'terrain-brush', message: 'Terrain brush history contains invalid strokes.' });
  }
  return issues;
}

export function compileProjectHash(project: TrackPrintProject): string {
  const lookup = createStationLookup(project.track, 64);
  const surface = compileTrackSurface(project.track, lookup, 128);
  return fnv1a(
    stableStringify({
      source: JSON.parse(serializeProject(project)),
      stationCount: lookup.samples.length,
      asphaltVertices: surface.asphalt.positions.length / 3,
      curbIds: surface.curbs.map((curb) => curb.intervalId).sort(),
      runoffIds: surface.runoffs.map((runoff) => runoff.intervalId).sort(),
    }),
  );
}

export function createExampleProject(kind: 'flat' | 'elevation' | 'curbs' | 'terrain'): TrackPrintProject {
  const track = createDefaultTrackDocument();
  const terrain = createTerrainDocument({
    origin: { x: -180, z: -180 },
    size: { width: 360, depth: 360 },
    resolution: { columns: 73, rows: 73 },
    defaultMaterial: kind === 'terrain' ? 'gravel' : 'grass',
  });

  if (kind === 'elevation') {
    return createProject({ ...track, elevation: { keys: [{ station: 0, value: 5 }] } }, terrain, { name: 'Elevation Example' });
  }
  if (kind === 'curbs') {
    return createProject(
      {
        ...track,
        curbs: [{ id: 'example-curb', side: 'left', startStation: 20, endStation: 120, width: 1.2, height: 0.12, profile: 'raised', materialId: 'curb-red-white' }],
        runoffs: [{ id: 'example-runoff', side: 'right', startStation: 80, endStation: 180, width: 5, materialId: 'painted-runoff' }],
      },
      terrain,
      { name: 'Curbs and Runoff Example' },
    );
  }
  return createProject(track, terrain, { name: kind === 'terrain' ? 'Terrain Sculpt Example' : 'Flat Oval Example' });
}

function normalizeTerrain(value: Record<string, unknown>): TerrainDocument {
  return deserializeTerrainDocument(JSON.stringify(value));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
