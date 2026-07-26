import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMonzaTrack } from '../../src/level/tracks';
import { createMonzaDetailVisuals } from '../../src/level/MonzaDetail';

describe('Monza high-detail environment', () => {
  it('exposes authored detail layers for the default Monza track', () => {
    const track = buildMonzaTrack();
    const detail = track.features.monzaDetail;

    expect(detail).toBeTruthy();
    expect(detail?.treeSpecies.map((s) => s.id)).toEqual(
      expect.arrayContaining(['hornbeam', 'horse-chestnut', 'plane', 'wild-cherry', 'lime', 'oak']),
    );
    expect(detail?.fenceRuns.length).toBeGreaterThanOrEqual(5);
    expect(track.features.forests?.length).toBeGreaterThanOrEqual(20);
    expect(detail?.serviceRoads.length).toBeGreaterThanOrEqual(4);
    expect(detail?.builtAreas.length).toBeGreaterThanOrEqual(5);
    expect(detail?.paintedRunoffs.length).toBeGreaterThanOrEqual(6);
    expect(detail?.brakingBoards.length).toBeGreaterThanOrEqual(24);
  });

  it('applies committed OpenTopo elevation samples as a normalized Monza terrain profile', () => {
    const track = buildMonzaTrack();
    const terrain = track.world.terrainTrack;

    expect(track.features.monzaDetail?.openTopo.source).toContain('OpenTopo');
    expect(track.features.monzaDetail?.openTopo.controls.length).toBeGreaterThan(40);
    expect(terrain?.samples).toHaveLength(track.centerline.length);

    const elevations = track.centerline.map((sample) => sample.elevation);
    expect(Math.min(...elevations)).toBeCloseTo(0, 4);
    expect(Math.max(...elevations)).toBeGreaterThan(5);
    expect(Math.max(...elevations)).toBeLessThan(12);
    const worstStep = elevations.slice(1).reduce((max, elevation, i) => Math.max(max, Math.abs(elevation - elevations[i])), 0);
    expect(worstStep).toBeLessThan(0.03);
    expect(track.spawn.position[1]).toBeCloseTo(track.centerline[0].elevation + 0.72, 4);
    expect(track.centerline.some((sample) => sample.normal[1] < 0.9999)).toBe(true);
  });

  it('renders repeated Monza details as instanced cullable groups', () => {
    const track = buildMonzaTrack();
    const detail = track.features.monzaDetail!;
    const asset = createMonzaDetailVisuals(detail);

    const plainMeshes: string[] = [];
    const instancedNames: string[] = [];
    asset.object.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.name.startsWith('monza-detail-')) {
        instancedNames.push(obj.name);
        expect(obj.frustumCulled).toBe(true);
        expect(obj.count).toBeGreaterThan(0);
      } else if (obj instanceof THREE.Mesh && obj.name.startsWith('monza-detail-')) {
        plainMeshes.push(obj.name);
      }
    });

    expect(plainMeshes).toEqual([]);
    expect(instancedNames).toEqual(expect.arrayContaining([
      'monza-detail-fence-posts',
      'monza-detail-fence-rails',
      'monza-detail-service-roads',
      'monza-detail-built-areas',
      'monza-detail-runoff-green',
      'monza-detail-braking-boards',
    ]));
    // Keep the detail pass bounded: several batched layers, not one draw per object.
    expect(instancedNames.length).toBeLessThanOrEqual(12);

    for (const disposable of asset.disposables) disposable.dispose();
  });
});
