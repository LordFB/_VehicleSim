import { describe, expect, it } from 'vitest';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { compileTrackSurface } from '@trackprint/track-compiler';
import { createStationLookup, repairTrackContinuity, type TrackDocument } from '@trackprint/track-core';
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
    // The default fixture authors 3 sectors, so checkpoints now track those
    // sector boundaries (one per sector end) rather than the legacy even spacing.
    expect(track.checkpoints).toHaveLength(3);
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

  it('emits oriented barriers for an authored wall (no longer barriers: [])', () => {
    const base = createDefaultTrackDocument();
    const source: typeof base = {
      ...base,
      walls: [
        {
          id: 'pit-wall',
          points: [
            { x: 50, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 60 },
          ],
          cornerMode: 'cornered',
          cornerRadius: 4,
          height: 1.2,
          segmentLength: 2,
          style: 'armco',
          materialId: 'armco',
        },
      ],
    };
    const track = createVehicleSimTrackFromTrackPrint(source);
    expect(track.world.barriers.length).toBeGreaterThan(10);
    // Each barrier stands on the ground (positive y-center) and is oriented.
    for (const barrier of track.world.barriers) {
      expect(barrier.center[1]).toBeGreaterThan(0);
      expect(barrier.halfExtents[1]).toBeCloseTo(0.6, 2); // height/2
      expect(typeof barrier.yawRad).toBe('number');
    }
    // The empty-document case still produces no barriers.
    expect(createVehicleSimTrackFromTrackPrint(base).world.barriers).toHaveLength(0);
  });

  it('places timing checkpoints at authored sector boundaries, in order', () => {
    const track = createVehicleSimTrackFromTrackPrint(createDefaultTrackDocument());
    // Default fixture has 3 sectors → 3 checkpoints.
    expect(track.checkpoints).toHaveLength(3);
    // No-sector document falls back to even spacing at the requested count.
    const noSectors = { ...createDefaultTrackDocument(), sectors: [] };
    const fallback = createVehicleSimTrackFromTrackPrint(noSectors, { checkpointCount: 8 });
    expect(fallback.checkpoints).toHaveLength(8);
  });

  it('honors an author-placed start/finish marker over the auto line', () => {
    const auto = createVehicleSimTrackFromTrackPrint(createDefaultTrackDocument());
    const placed = createVehicleSimTrackFromTrackPrint({
      ...createDefaultTrackDocument(),
      startFinish: { id: 'sf', station: 280 },
    });
    // The placed line sits at a different world position than the auto one.
    const moved =
      Math.hypot(
        placed.startFinish.center[0] - auto.startFinish.center[0],
        placed.startFinish.center[1] - auto.startFinish.center[1],
      ) > 5;
    expect(moved).toBe(true);
  });

  it('compiles a side-road aux path: its walls become extra barriers', () => {
    const main = createDefaultTrackDocument();
    const pit: TrackDocument = {
      id: 'pit',
      version: 1,
      units: 'meters',
      closed: false,
      width: { left: { constant: 3 }, right: { constant: 3 } },
      walls: [
        {
          id: 'pit-outer',
          points: [
            { x: 100, y: 24 },
            { x: 160, y: 24 },
          ],
          cornerMode: 'cornered',
          cornerRadius: 4,
          height: 1,
          segmentLength: 2,
          style: 'solid',
          materialId: 'concrete',
        },
      ],
      segments: [
        {
          id: 'pit-seg',
          kind: 'cubicBezier',
          p0: { id: 'pp0', position: { x: 100, y: 20 } },
          p1: { id: 'pp1', position: { x: 120, y: 20 } },
          p2: { id: 'pp2', position: { x: 140, y: 20 } },
          p3: { id: 'pp3', position: { x: 160, y: 20 } },
        },
      ],
    };
    const withoutAux = createVehicleSimTrackFromTrackPrint(main).world.barriers.length;
    const withAux = createVehicleSimTrackFromTrackPrint({ ...main, auxPaths: [
      { id: 'pitlane', role: 'pit', entryStation: 10, exitStation: 60, document: pit },
    ] }).world.barriers.length;
    expect(withAux).toBeGreaterThan(withoutAux);
  });
});
