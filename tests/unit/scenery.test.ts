import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Scenery } from '../../src/render/Scenery';
import { SCENERY } from '../../src/core/Constants';

describe('Scenery', () => {
  it('builds an all-instanced cosmetic group (few draw calls, not hundreds of meshes)', () => {
    const scenery = new Scenery();
    const meshes: THREE.Mesh[] = [];
    let instancedCount = 0;
    scenery.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) instancedCount++;
      else if (obj instanceof THREE.Mesh) meshes.push(obj);
    });
    // Everything that repeats must be an InstancedMesh; no per-object plain Mesh leaks.
    expect(meshes.length).toBe(0);
    // hills + 3 tree layers + posts + reflectors = 6 instanced draw groups.
    expect(instancedCount).toBe(6);
    scenery.dispose();
  });

  it('is deterministic across instances (seeded layout for stable screenshots)', () => {
    const a = matricesOf(new Scenery());
    const b = matricesOf(new Scenery());
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('keeps the circuit footprint mostly clear of trees', () => {
    // Trees scatter across the footprint but are kept off the racing surface: only a
    // sparse few are allowed through inside the bounding box, and none right on it.
    const bounds = { minX: -30, maxX: 430, minZ: -270, maxZ: 420 };
    const scenery = new Scenery(bounds);
    const trunks = findInstanced(scenery.group, 'scenery-tree-trunks');
    expect(trunks).toBeTruthy();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    let total = 0;
    let inside = 0;
    const clr = SCENERY.TREE_CORRIDOR_HALF;
    for (let i = 0; i < trunks!.count; i++) {
      trunks!.getMatrixAt(i, m);
      m.decompose(pos, q, scl);
      if (scl.x < 0.01) continue; // collapsed/unused instance
      total++;
      if (
        pos.x > bounds.minX - clr && pos.x < bounds.maxX + clr &&
        pos.z > bounds.minZ - clr && pos.z < bounds.maxZ + clr
      ) inside++;
    }
    expect(total).toBeGreaterThan(0);
    // The vast majority of placed trees sit outside the circuit footprint.
    expect(inside / total).toBeLessThan(0.25);
    scenery.dispose();
  });
});

function findInstanced(group: THREE.Object3D, name: string): THREE.InstancedMesh | null {
  let found: THREE.InstancedMesh | null = null;
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name === name) found = o;
  });
  return found;
}

function matricesOf(scenery: Scenery): number[] {
  const out: number[] = [];
  const m = new THREE.Matrix4();
  scenery.group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        out.push(...m.elements);
      }
    }
  });
  scenery.dispose();
  return out;
}
