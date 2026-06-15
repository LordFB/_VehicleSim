import { describe, expect, it } from 'vitest';
import { compileTrackSurface } from '@trackprint/track-compiler';
import { createStationLookup } from '@trackprint/track-core';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { createTerrainDocument, deriveCorridorBoundary, generateSkirtMesh, generateTerrainMesh } from '@trackprint/terrain-core';
import { defaultExportSettings, exportProject, reloadExportPreview } from './exportProject';

describe('project export', () => {
  it('creates a reloadable GLB payload with stable mesh stats and metadata', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 64);
    const terrain = createTerrainDocument();
    const terrainMesh = generateTerrainMesh(terrain);
    const skirtMesh = generateSkirtMesh(terrain, deriveCorridorBoundary(surface), 8);
    const exported = exportProject(document, surface, terrainMesh, skirtMesh, defaultExportSettings);
    const reloaded = reloadExportPreview(exported.glbBytes);

    expect(exported.glbBytes.length).toBeGreaterThan(20);
    expect(exported.manifest.project.sourceHash).toMatch(/^[0-9a-f]{8}$/);
    expect(exported.manifest.meshes.some((mesh) => mesh.collision)).toBe(true);
    expect(exported.manifest.sectors.map((sector) => sector.id)).toEqual(document.sectors?.map((sector) => sector.id));
    expect(reloaded.vertexCount).toBe(exported.stats.vertexCount);
    expect(reloaded.meshCount).toBe(exported.stats.meshCount);
  });
});
