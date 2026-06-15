import { describe, expect, it } from 'vitest';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { compileTrackSurface } from '@trackprint/track-compiler';
import { createStationLookup, repairTrackContinuity } from '@trackprint/track-core';
import {
  createVehicleSimTrackFromTrackPrint,
  serializeTrackPrintCollisionSurface,
  serializeTrackPrintSurface,
  serializeTrackPrintTerrainMesh,
} from '../../src/editor/trackprint/vehicleSimExport';

describe('TrackPrint Vehicle Sim export adapter', () => {
  it('compiles a TrackPrint document into a drivable terrain track definition', () => {
    const track = createVehicleSimTrackFromTrackPrint(createDefaultTrackDocument(), {
      id: 'trackprint',
      displayName: 'TrackPrint Test Course',
    });

    expect(track.id).toBe('trackprint');
    expect(track.displayName).toBe('TrackPrint Test Course');
    expect(track.centerline.length).toBeGreaterThan(64);
    expect(track.centerline.length).toBeGreaterThan(700);
    expect(track.world.terrainTrack?.samples).toHaveLength(track.centerline.length);
    expect(track.world.defaultMaterialId).toBe('grass');
    expect(track.world.zones.some((zone) => zone.materialId === 'grass')).toBe(true);
    const asphalt = track.world.materials.find((material) => material.id === 'asphalt_new');
    expect(asphalt?.muLongitudinal).toBeGreaterThanOrEqual(1.5);
    expect(asphalt?.muLateral).toBeGreaterThanOrEqual(1.4);
    expect(track.features.generatedGround).toBe(false);
    expect(track.features.generatedTerrain).toBe(false);
    expect(track.features.generatedScenery).toBe(false);
    expect(track.features.textureStyle).toBe('trackprint');
    expect(track.checkpoints.length).toBeGreaterThanOrEqual(6);
    expect(track.spawn.position[1]).toBeGreaterThan(0.5);
    expect(track.metadata.realLengthMeters).toBeGreaterThan(100);
  });

  it('uses dense regular rows so rendered quads and physics samples stay aligned', () => {
    const track = createVehicleSimTrackFromTrackPrint(createDefaultTrackDocument(), {
      targetSpacingMeters: 0.75,
    });

    const spacings = track.centerline.map((sample, index) => {
      const next = track.centerline[(index + 1) % track.centerline.length];
      return Math.hypot(next.pos[0] - sample.pos[0], next.pos[1] - sample.pos[1]);
    });
    const average = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    expect(average).toBeLessThan(0.9);
    expect(Math.max(...spacings)).toBeLessThan(1.6);
  });

  it('smooths exported elevation and camber for simulator tire contact', () => {
    const source = {
      ...createDefaultTrackDocument(),
      elevation: {
        keys: [
          { station: 0, value: 0 },
          { station: 40, value: 4 },
          { station: 80, value: -2 },
          { station: 120, value: 3 },
        ],
      },
      banking: {
        keys: [
          { station: 0, value: 0.2 },
          { station: 60, value: -0.2 },
          { station: 120, value: 0.16 },
        ],
      },
    };

    const track = createVehicleSimTrackFromTrackPrint(source, {
      targetSpacingMeters: 0.75,
    });

    const maxCamber = Math.max(...track.centerline.map((sample) => Math.abs(sample.camber)));
    const maxHeightStep = Math.max(...track.centerline.map((sample, index) => {
      const next = track.centerline[(index + 1) % track.centerline.length];
      return Math.abs(next.elevation - sample.elevation);
    }));
    expect(maxCamber).toBeLessThanOrEqual(0.08);
    expect(maxHeightStep).toBeLessThan(0.18);
  });

  it('serializes the compiled TrackPrint surface for exact simulator rendering', () => {
    const document = repairTrackContinuity(createDefaultTrackDocument());
    const lookup = createStationLookup(document, 128);
    const surface = compileTrackSurface(document, lookup, 384);
    const serialized = serializeTrackPrintSurface(surface);

    expect(serialized.asphalt.positions.length).toBeGreaterThan(0);
    expect(serialized.asphalt.indices.length).toBeGreaterThan(0);
    expect(serialized.bands.length).toBe(surface.curbs.length + surface.runoffs.length);
    expect(serialized.bands.every((band) => band.positions.length > 0 && band.indices.length > 0)).toBe(true);
  });

  it('preserves TrackPrint mesh normals and uvs for terrain and skirt rendering', () => {
    const serialized = serializeTrackPrintTerrainMesh({
      positions: new Float32Array([0, 0, 0, 1.23456, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    });

    expect(serialized.positions[3]).toBe(1.235);
    expect(serialized.normals).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(serialized.uvs).toEqual([0, 0, 1, 0, 0, 1]);
    expect(serialized.indices).toEqual([0, 1, 2]);
  });

  it('serializes TrackPrint mesh layers for simulator collision', () => {
    const document = repairTrackContinuity(createDefaultTrackDocument());
    const lookup = createStationLookup(document, 128);
    const surface = compileTrackSurface(document, lookup, 384);
    const flatTerrain = {
      positions: new Float32Array([-10, -1, -10, 10, -1, -10, -10, -1, 10, 10, -1, 10]),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    };
    const collision = serializeTrackPrintCollisionSurface(surface, flatTerrain, flatTerrain);

    expect(collision.layers.some((layer) => layer.id === 'trackprint-asphalt')).toBe(true);
    expect(collision.layers.some((layer) => layer.id === 'trackprint-terrain')).toBe(true);
    expect(collision.layers.some((layer) => layer.id === 'trackprint-skirt')).toBe(true);
    expect(collision.layers.every((layer) => layer.positions.length > 0 && layer.indices.length > 0)).toBe(true);
  });
});
