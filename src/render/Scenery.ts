import * as THREE from 'three';
import { SCENERY } from '../core/Constants';

/**
 * Environmental scenery that gives the world a sense of place — the single biggest
 * gap against the Forza Horizon target, where the playable strip otherwise floats
 * on an empty green plane. This is purely cosmetic: it consumes nothing from the
 * physics and adds nothing the car can collide with.
 *
 * Everything that repeats is drawn with InstancedMesh so a few hundred trees and
 * posts cost a handful of draw calls, not hundreds (see threejs-perf discipline).
 * Placement is driven by a small seeded RNG so the layout is deterministic — e2e
 * screenshots stay stable frame to frame and run to run.
 *
 * Layers, near to far:
 *  - roadside reflector posts marching down both verges (depth cue + speed read)
 *  - a scattered forest ring around the arena, denser the further out
 *  - low rolling background hills on the horizon under the haze
 */
export type TrackBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export class Scenery {
  readonly group = new THREE.Group();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly bounds: TrackBounds;
  private readonly postLine: Array<[number, number]>;

  /**
   * @param bounds   the circuit's footprint; trees are kept outside it (plus a margin)
   *                 so the forest of the royal park rings the track without spawning on
   *                 the racing surface. Defaults to a small central box if omitted.
   * @param postLine a polyline (x,z) along the track for marshalling the reflector
   *                 posts; defaults to a short straight if omitted.
   */
  constructor(bounds?: TrackBounds, postLine?: Array<[number, number]>) {
    this.bounds = bounds ?? { minX: -22, maxX: 22, minZ: -50, maxZ: 90 };
    this.postLine = postLine ?? defaultPostLine();
    this.group.name = 'scenery';
    const rng = mulberry32(SCENERY.SEED);
    this.buildHills(rng);
    this.buildForest(rng);
    this.buildPosts();
  }

  /** Low, broad background hills ringing the arena, sitting in the haze band. */
  private buildHills(rng: () => number): void {
    const trunkGeo = new THREE.ConeGeometry(1, 1, 7, 1, true);
    this.disposables.push(trunkGeo);
    const count = SCENERY.HILL_COUNT;
    const mesh = new THREE.InstancedMesh(trunkGeo, this.hillMaterial(), count);
    mesh.name = 'scenery-hills';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const dist = SCENERY.HILL_RADIUS * (0.85 + rng() * 0.4);
      const radius = SCENERY.HILL_MIN_R + rng() * (SCENERY.HILL_MAX_R - SCENERY.HILL_MIN_R);
      const height = radius * (0.4 + rng() * 0.4);
      pos.set(Math.cos(ang) * dist, height * 0.5 - 2, Math.sin(ang) * dist);
      scl.set(radius, height, radius);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** A scattered conifer forest ring: each tree is a trunk + two foliage cones. */
  private buildForest(rng: () => number): void {
    const count = SCENERY.TREE_COUNT;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
    const foliageGeo = new THREE.ConeGeometry(1, 1, 8);
    this.disposables.push(trunkGeo, foliageGeo);

    const trunks = new THREE.InstancedMesh(trunkGeo, this.trunkMaterial(), count);
    const lower = new THREE.InstancedMesh(foliageGeo, this.foliageMaterial(0), count);
    const upper = new THREE.InstancedMesh(foliageGeo, this.foliageMaterial(1), count);
    trunks.name = 'scenery-tree-trunks';
    lower.name = 'scenery-tree-lower';
    upper.name = 'scenery-tree-upper';
    for (const im of [trunks, lower, upper]) {
      im.castShadow = false; // distant; shadows would thrash the shadow atlas for no gain
      im.receiveShadow = false;
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();
    // Scatter over the whole circuit footprint (the royal park) and reject any tree
    // that falls on or near the track; trees fill both the infield and the surrounds.
    const cx = (this.bounds.minX + this.bounds.maxX) / 2;
    const cz = (this.bounds.minZ + this.bounds.maxZ) / 2;
    const spanX = this.bounds.maxX - this.bounds.minX;
    const spanZ = this.bounds.maxZ - this.bounds.minZ;
    const half = Math.max(spanX, spanZ) / 2 + SCENERY.TREE_OUTER_R;
    const clearance = SCENERY.TREE_CORRIDOR_HALF; // keep trees this far off the ribbon edge
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      const x = cx + (rng() * 2 - 1) * half;
      const z = cz + (rng() * 2 - 1) * half;
      // Don't drop trees inside the circuit footprint (plus clearance) — the racing
      // surface and its immediate verges stay clear.
      if (
        x > this.bounds.minX - clearance && x < this.bounds.maxX + clearance &&
        z > this.bounds.minZ - clearance && z < this.bounds.maxZ + clearance
      ) {
        if (rng() < 0.82) continue; // mostly clear inside the box; let a few infield trees through sparsely
      }

      const scale = SCENERY.TREE_MIN_H + rng() * (SCENERY.TREE_MAX_H - SCENERY.TREE_MIN_H);
      const yaw = rng() * Math.PI * 2;
      q.setFromAxisAngle(UP, yaw);

      // Per-tree foliage tint: a real tree-line is never one flat green. Jitter hue
      // toward yellow/blue and lightness so the forest reads as many trees, not a wall.
      tint.setHSL(0.30 + (rng() - 0.5) * 0.05, 0.45 + rng() * 0.2, 0.5 + (rng() - 0.5) * 0.28);
      lower.setColorAt(placed, tint);
      upper.setColorAt(placed, tint);

      const trunkH = scale * 0.42;
      pos.set(x, trunkH * 0.5, z);
      scl.set(scale * 0.5, trunkH, scale * 0.5);
      m.compose(pos, q, scl);
      trunks.setMatrixAt(placed, m);

      const lowerH = scale * 0.7;
      pos.set(x, trunkH + lowerH * 0.4, z);
      scl.set(scale * 0.62, lowerH, scale * 0.62);
      m.compose(pos, q, scl);
      lower.setMatrixAt(placed, m);

      const upperH = scale * 0.55;
      pos.set(x, trunkH + lowerH * 0.7 + upperH * 0.3, z);
      scl.set(scale * 0.42, upperH, scale * 0.42);
      m.compose(pos, q, scl);
      upper.setMatrixAt(placed, m);

      placed++;
    }
    // If the corridor rejection left unused instances, collapse them to zero scale.
    for (let i = placed; i < count; i++) {
      m.compose(ZERO, q, ZERO_SCALE);
      trunks.setMatrixAt(i, m);
      lower.setMatrixAt(i, m);
      upper.setMatrixAt(i, m);
    }
    for (const im of [trunks, lower, upper]) im.instanceMatrix.needsUpdate = true;
    if (lower.instanceColor) lower.instanceColor.needsUpdate = true;
    if (upper.instanceColor) upper.instanceColor.needsUpdate = true;
    this.group.add(trunks, lower, upper);
  }

  /**
   * Reflector marker posts marching down both verges of the track. Posts are placed at
   * evenly spaced arc-length stations along {@link postLine}, offset to either side by
   * the post setback along the local left-normal, so they follow every corner.
   */
  private buildPosts(): void {
    const stations = this.postStations();
    const total = stations.length;
    const postGeo = new THREE.CylinderGeometry(0.05, 0.06, SCENERY.POST_HEIGHT, 5);
    const capGeo = new THREE.BoxGeometry(0.16, 0.12, 0.04);
    this.disposables.push(postGeo, capGeo);

    const posts = new THREE.InstancedMesh(postGeo, this.postMaterial(), Math.max(1, total));
    const caps = new THREE.InstancedMesh(capGeo, this.reflectorMaterial(), Math.max(1, total));
    posts.name = 'scenery-posts';
    caps.name = 'scenery-reflectors';
    posts.castShadow = true;
    caps.castShadow = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    stations.forEach(([x, z], i) => {
      pos.set(x, SCENERY.POST_HEIGHT * 0.5, z);
      m.compose(pos, q, one);
      posts.setMatrixAt(i, m);
      pos.set(x, SCENERY.POST_HEIGHT * 0.82, z);
      m.compose(pos, q, one);
      caps.setMatrixAt(i, m);
    });
    posts.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.group.add(posts, caps);
  }

  /** Evenly spaced post positions on both verges, following the track line. */
  private postStations(): Array<[number, number]> {
    const line = this.postLine;
    const out: Array<[number, number]> = [];
    const setback = SCENERY.POST_X;
    // Walk arc length, dropping a pair of posts every POST_SPACING metres.
    let acc = 0;
    let next = 0;
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const [bx, bz] = line[i];
      const dx = bx - ax, dz = bz - az;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1e-4) continue;
      while (acc + segLen >= next) {
        const t = (next - acc) / segLen;
        const px = ax + dx * t, pz = az + dz * t;
        const nx = -dz / segLen, nz = dx / segLen; // left-normal
        out.push([px + nx * setback, pz + nz * setback]);
        out.push([px - nx * setback, pz - nz * setback]);
        next += SCENERY.POST_SPACING;
      }
      acc += segLen;
    }
    return out;
  }

  private hillMaterial(): THREE.Material {
    const mat = new THREE.MeshStandardMaterial({ color: SCENERY.HILL_COLOR, roughness: 1, metalness: 0, flatShading: true });
    this.disposables.push(mat);
    return mat;
  }

  private trunkMaterial(): THREE.Material {
    const mat = new THREE.MeshStandardMaterial({ color: SCENERY.TRUNK_COLOR, roughness: 0.95, metalness: 0 });
    this.disposables.push(mat);
    return mat;
  }

  private foliageMaterial(tier: number): THREE.Material {
    // White base so the per-instance tint (setColorAt) reads true; the upper tier is
    // kept a touch brighter for a sunlit-canopy gradient.
    const mat = new THREE.MeshStandardMaterial({
      color: tier === 0 ? 0xcfcfcf : 0xffffff,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    this.disposables.push(mat);
    return mat;
  }

  private postMaterial(): THREE.Material {
    const mat = new THREE.MeshStandardMaterial({ color: SCENERY.POST_COLOR, roughness: 0.5, metalness: 0.1 });
    this.disposables.push(mat);
    return mat;
  }

  private reflectorMaterial(): THREE.Material {
    // Emissive so the markers read like retroreflectors catching the low sun.
    const mat = new THREE.MeshStandardMaterial({
      color: SCENERY.REFLECTOR_COLOR,
      emissive: SCENERY.REFLECTOR_COLOR,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0,
    });
    this.disposables.push(mat);
    return mat;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh) obj.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3(0, -9999, 0);
const ZERO_SCALE = new THREE.Vector3(0.0001, 0.0001, 0.0001);

/** Fallback post line (a short straight) when no track line is supplied. */
function defaultPostLine(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = SCENERY.POST_START_Z; z <= SCENERY.POST_START_Z + SCENERY.POST_COUNT * SCENERY.POST_SPACING; z += SCENERY.POST_SPACING) {
    out.push([0, z]);
  }
  return out;
}

/** Small deterministic PRNG so scenery layout is stable across runs (seeded). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
