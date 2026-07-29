import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildMonzaTrack } from '../../src/level/tracks';
import { createMonzaDetailVisuals } from '../../src/level/MonzaDetail';
import { SurfaceSystem } from '../../src/sim/runtime/SurfaceSystem';

describe('Monza named-corner fidelity', () => {
  it('models Rettifilo as a straight-ahead driveable escape road with an open barrier gap', () => {
    const track = buildMonzaTrack();
    const detail = track.features.monzaDetail!;
    const escape = detail.surfaceAreas.find((area) => area.name === 'rettifilo-straight-escape');

    expect(escape).toBeTruthy();
    expect(escape?.materialId).toBe('asphalt_new');
    expect(Math.max(...escape!.points.map((point) => point[1])) - Math.min(...escape!.points.map((point) => point[1]))).toBeGreaterThan(90);
    expect(Math.max(...escape!.points.map((point) => point[0])) - Math.min(...escape!.points.map((point) => point[0]))).toBeLessThan(8);

    const probe: [number, number, number] = [0, 20, 345];
    expect(new SurfaceSystem(track.world).query(probe).materialId).toBe('asphalt_new');
    expect(track.world.barriers.some((barrier) =>
      Math.abs(barrier.center[0]) < 4 && barrier.center[2] > 305 && barrier.center[2] < 385,
    )).toBe(false);
  });

  it('commits named runoff polygons and corner-specific image research', () => {
    const detail = buildMonzaTrack().features.monzaDetail!;
    expect(detail.surfaceAreas.map((area) => area.name)).toEqual(expect.arrayContaining([
      'rettifilo-straight-escape',
      'roggia-braking-overrun',
      'lesmo-one-outer-gravel',
      'lesmo-two-outer-gravel',
      'ascari-entry-gravel',
      'ascari-exit-painted-runoff',
      'alboreto-outer-asphalt',
    ]));
    expect(detail.referenceSurvey.sources.map((source) => source.observation).join(' ')).toMatch(
      /Rettifilo.*straight-ahead escape/i,
    );
  });

  it('renders polygon surfaces as bounded meshes at terrain height', () => {
    const detail = buildMonzaTrack().features.monzaDetail!;
    const asset = createMonzaDetailVisuals(detail);
    const surfaceGroup = asset.object.getObjectByName('monza-detail-corner-surfaces');
    expect(surfaceGroup).toBeInstanceOf(THREE.Group);
    expect(surfaceGroup?.children.length).toBeGreaterThanOrEqual(7);
    expect(surfaceGroup?.children.every((child) => child instanceof THREE.Mesh)).toBe(true);
    for (const disposable of asset.disposables) disposable.dispose();
  });
});
