import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createArmcoBarrierVisuals,
  createDetailedRoadGeometry,
  createTerrainCorridorGeometry,
  roadSurfaceHeight,
} from '../../src/level/GeneratedTrackMeshes';
import { buildNordschleifeTrack } from '../../src/level/NordschleifeWorld';

describe('generated high-detail track meshes', () => {
  const track = buildNordschleifeTrack();
  const terrain = track.world.terrainTrack!;

  it('builds a dense crowned road ribbon instead of a two-edge strip', () => {
    const geometry = createDetailedRoadGeometry(terrain.samples, terrain.halfWidth);
    const positions = geometry.getAttribute('position');
    expect(positions.count).toBe((terrain.samples.length + 1) * 7);
    expect(positions.count).toBeGreaterThan((terrain.samples.length + 1) * 2);
    expect(geometry.getIndex()?.count ?? 0).toBeGreaterThan(terrain.samples.length * 12);
    geometry.dispose();
  });

  it('encodes camber and crown into road surface heights', () => {
    const sample = terrain.samples.find((p) => Math.abs(p.camber) > 0.025)!;
    const right = roadSurfaceHeight(sample, -terrain.halfWidth, terrain.halfWidth);
    const center = roadSurfaceHeight(sample, 0, terrain.halfWidth);
    const left = roadSurfaceHeight(sample, terrain.halfWidth, terrain.halfWidth);
    expect(Math.abs(left - right)).toBeGreaterThan(0.03);
    expect(center).toBeGreaterThan(Math.min(left, right));
  });

  it('builds a height-varying colored terrain corridor around the track', () => {
    const geometry = createTerrainCorridorGeometry(terrain.samples, terrain.halfWidth, terrain.shoulderWidth);
    const positions = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < positions.count; i += 1) {
      const y = positions.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(colors.count).toBe(positions.count);
    expect(maxY - minY).toBeGreaterThan(4);
    geometry.dispose();
  });

  it('renders oriented barrier specs as instanced Armco rails and posts', () => {
    const asset = createArmcoBarrierVisuals(track.world.barriers.slice(0, 12));
    const rails = asset.object.children.find((child) => child.name === 'armco-rails');
    const posts = asset.object.children.find((child) => child.name === 'armco-posts');
    expect(rails).toBeInstanceOf(THREE.InstancedMesh);
    expect(posts).toBeInstanceOf(THREE.InstancedMesh);
    expect((rails as THREE.InstancedMesh).count).toBe(24);
    expect((posts as THREE.InstancedMesh).count).toBe(12);
    asset.disposables.forEach((disposable) => disposable.dispose());
  });
});
