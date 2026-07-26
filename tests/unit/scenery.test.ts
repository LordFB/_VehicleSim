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
    // hills + billboard tree chunks + posts + reflectors. This can grow with cull chunks,
    // but must stay bounded instead of scaling with individual trees.
    expect(instancedCount).toBeGreaterThanOrEqual(6);
    expect(instancedCount).toBeLessThanOrEqual(26);
    scenery.dispose();
  });

  it('is deterministic across instances (seeded layout for stable screenshots)', () => {
    const a = matricesOf(new Scenery());
    const b = matricesOf(new Scenery());
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('places trees inside the real forest masses and off the ribbon', () => {
    // The product path supplies real Parco di Monza woodland masses + the track line.
    // Trees should cluster inside the masses and never land on the racing surface.
    const bounds = { minX: -30, maxX: 430, minZ: -270, maxZ: 420 };
    // A straight stretch of "track" up +Z and two woodland masses either side of it.
    const trackLine: Array<[number, number]> = [];
    for (let z = -40; z <= 120; z += 8) trackLine.push([0, z]);
    const forests = [
      { cx: -60, cz: 40, hx: 30, hz: 60 },
      { cx: 70, cz: 40, hx: 30, hz: 60 },
    ];
    const scenery = new Scenery(bounds, trackLine, forests);
    const trunks = findInstanced(scenery.group, 'scenery-tree-trunks');
    expect(trunks).toBeTruthy();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const clr = SCENERY.TREE_CORRIDOR_HALF;
    let total = 0;
    let onRibbon = 0;
    let inAMass = 0;
    for (let i = 0; i < trunks!.count; i++) {
      trunks!.getMatrixAt(i, m);
      m.decompose(pos, q, scl);
      if (scl.x < 0.01) continue; // collapsed/unused instance
      total++;
      // distance to the (straight, x=0) ribbon segment
      const onTrack = Math.abs(pos.x) <= clr && pos.z >= -48 && pos.z <= 128;
      if (onTrack) onRibbon++;
      if (forests.some((f) => Math.abs(pos.x - f.cx) <= f.hx * 1.2 && Math.abs(pos.z - f.cz) <= f.hz * 1.2)) inAMass++;
    }
    expect(total).toBeGreaterThan(0);
    // No tree sits on the racing surface.
    expect(onRibbon).toBe(0);
    // The overwhelming majority sit inside (or right at the soft edge of) a real mass.
    expect(inAMass / total).toBeGreaterThan(0.9);
    scenery.dispose();
  });

  it('uses species-aware broadleaf billboard chunks with culling enabled', () => {
    const scenery = new Scenery();
    const billboardChunks: THREE.InstancedMesh[] = [];
    const species = new Set<string>();
    scenery.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.name.startsWith('scenery-tree-billboard-')) {
        billboardChunks.push(obj);
        expect(obj.frustumCulled).toBe(true);
        const speciesId = obj.userData.speciesId;
        if (typeof speciesId === 'string') species.add(speciesId);
      }
    });

    expect(billboardChunks.length).toBeGreaterThan(4);
    expect([...species]).toEqual(expect.arrayContaining(['hornbeam', 'horse-chestnut', 'plane', 'wild-cherry', 'lime']));
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
