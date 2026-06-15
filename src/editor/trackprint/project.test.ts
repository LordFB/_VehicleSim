import { describe, expect, it } from 'vitest';
import { createTerrainDocument } from '@trackprint/terrain-core';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import { compileProjectHash, createExampleProject, createProject, loadProject, migrateProject, serializeProject, validateProject } from './project';

describe('project documents', () => {
  it('round-trips track, terrain, sectors, and brush data', () => {
    const project = createProject(
      {
        ...createStraightTrackDocument(),
        sectors: [{ id: 'sector-a', name: 'Sector A', startStation: 0, endStation: 50 }],
      },
      {
      ...createTerrainDocument({ resolution: { columns: 2, rows: 1 } }),
      heights: [0, 3],
      materials: ['grass', 'dirt'],
      brushStrokes: [{ id: 'brush-a', type: 'raise', points: [{ x: 1, z: 2 }], radius: 3, strength: 1, falloff: 'smooth', timestamp: 1 }],
      },
    );
    const loaded = loadProject(serializeProject(project));

    expect(loaded.issues).toEqual([]);
    expect(loaded.project?.track.sectors).toEqual(project.track.sectors);
    expect(loaded.project?.terrain.heights).toEqual([0, 3]);
    expect(loaded.project?.terrain.brushStrokes).toHaveLength(1);
  });

  it('validates invalid terrain cell arrays', () => {
    const project = createProject(createDefaultTrackDocument(), {
      ...createTerrainDocument({ resolution: { columns: 2, rows: 2 } }),
      heights: [0],
    });

    expect(validateProject(project).some((issue) => issue.code === 'terrain-cells')).toBe(true);
  });

  it('migrates old track-plus-terrain payloads', () => {
    const migrated = migrateProject({ id: 'old', track: createDefaultTrackDocument(), terrain: createTerrainDocument() });

    expect(migrated.version).toBe(1);
    expect(migrated.id).toBe('old');
  });

  it('compiles deterministically for examples and reloads', () => {
    const example = createExampleProject('flat');
    const project = createProject(createStraightTrackDocument(), createTerrainDocument());
    const firstHash = compileProjectHash(project);
    const loaded = loadProject(serializeProject(project)).project;

    expect(loaded).toBeDefined();
    expect(compileProjectHash(project)).toBe(firstHash);
    expect(compileProjectHash(loaded as typeof project)).toBe(firstHash);
    expect(compileProjectHash(example)).toBe(compileProjectHash(example));
  });
});
