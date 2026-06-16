import { describe, expect, it } from 'vitest';
import { compileTrackSurface } from '@trackprint/track-compiler';
import { createStationLookup } from '@trackprint/track-core';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { createTerrainDocument, deriveCorridorBoundary, generateSkirtMesh, generateTerrainMesh } from '@trackprint/terrain-core';
import { createProject } from '../../src/editor/trackprint/project';
import {
  createVehicleSimTrackFromTrackPrint,
  serializeTrackPrintCollisionSurface,
  serializeTrackPrintSurface,
  serializeTrackPrintTerrainMesh,
} from '../../src/editor/trackprint/vehicleSimExport';
import { getTrackDefinition } from '../../src/level/tracks';
import { saveTrackPrintPreviewTrack } from '../../src/level/trackprintPreviewStorage';
import {
  TRACKPRINT_PACKAGE_EXTENSION,
  decodeTrackPrintPackage,
  encodeTrackPrintPackage,
  isTrackPrintPackageBytes,
} from '../../src/level/trackprintPackage';

describe('TrackPrint .tp binary package', () => {
  it('round-trips the source project, compiled sim track, and real-world terrain texture bytes', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 64);
    const terrain = {
      ...createTerrainDocument({ resolution: { columns: 3, rows: 2 } }),
      geo: {
        centerLat: 50.45,
        centerLon: 5.97,
        metersPerDegLat: 111_320,
        metersPerDegLon: 71_500,
        baseElevation: 410,
      },
    };
    const terrainMesh = generateTerrainMesh(terrain);
    const skirtMesh = generateSkirtMesh(terrain, deriveCorridorBoundary(surface), 8);
    const project = createProject(document, terrain, { name: 'Spa Import' });
    const track = createVehicleSimTrackFromTrackPrint(document, { displayName: 'Spa Import' });
    track.features.trackPrintTerrain = serializeTrackPrintTerrainMesh(terrainMesh);
    track.features.trackPrintSkirt = serializeTrackPrintTerrainMesh(skirtMesh);
    track.features.trackPrintSurface = serializeTrackPrintSurface(surface);
    track.world.meshSurface = serializeTrackPrintCollisionSurface(surface, terrainMesh, skirtMesh);

    const bytes = encodeTrackPrintPackage({
      project,
      track,
      assets: [
        {
          id: 'terrain-texture',
          role: 'terrain-texture',
          mimeType: 'image/png',
          name: 'satellite.png',
          bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
          width: 2,
          height: 2,
        },
      ],
    });
    const decoded = decodeTrackPrintPackage(bytes);

    expect(TRACKPRINT_PACKAGE_EXTENSION).toBe('.tp');
    expect(isTrackPrintPackageBytes(bytes)).toBe(true);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('TPKG');
    expect(decoded.project.metadata.name).toBe('Spa Import');
    expect(decoded.project.terrain.geo?.centerLat).toBe(50.45);
    expect(decoded.track.displayName).toBe('Spa Import');
    expect(decoded.track.features.trackPrintTerrain?.positions.length).toBeGreaterThan(0);
    expect(decoded.track.world.meshSurface?.layers.some((layer) => layer.id === 'trackprint-terrain')).toBe(true);
    expect(decoded.track.features.trackPrintTerrainTexture?.mimeType).toBe('image/png');
    expect(decoded.track.features.trackPrintTerrainTexture?.dataUrl).toContain('base64');
    expect(decoded.assets[0].bytes).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
  });

  it('feeds a decoded package into the existing TrackPrint preview loader', () => {
    const storage = new MemoryStorage();
    const document = createDefaultTrackDocument();
    const project = createProject(document, createTerrainDocument());
    const track = createVehicleSimTrackFromTrackPrint(document, { displayName: 'Dropped Package' });
    const decoded = decodeTrackPrintPackage(encodeTrackPrintPackage({ project, track, assets: [] }));

    saveTrackPrintPreviewTrack(decoded.track, storage);
    const loaded = getTrackDefinition(new URLSearchParams('track=trackprint'), storage);

    expect(loaded.id).toBe('trackprint');
    expect(loaded.displayName).toBe('Dropped Package');
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
