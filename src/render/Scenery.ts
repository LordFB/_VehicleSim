import * as THREE from 'three';
import { SCENERY } from '../core/Constants';
import type { TreeSpeciesSpec } from '../level/TrackDefinition';
import { MONZA_TREE_SPECIES } from '../level/MonzaDetail';

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

/** A real woodland mass (axis-aligned box) from the Parco di Monza, in game XZ. */
export type ForestMass = { cx: number; cz: number; hx: number; hz: number };

export class Scenery {
  readonly group = new THREE.Group();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private readonly bounds: TrackBounds;
  private readonly postLine: Array<[number, number]>;
  private readonly forests: ForestMass[];
  private readonly treeSpecies: TreeSpeciesSpec[];

  /**
   * @param bounds   the circuit's footprint; trees are kept off the racing surface.
   * @param postLine a polyline (x,z) along the track — used for the reflector posts AND
   *                 as the ribbon centerline for the precise tree-clearance test.
   * @param forests  real woodland masses (Parco di Monza, from OSM) to fill with trees;
   *                 when omitted, trees scatter uniformly over the footprint instead.
   */
  constructor(bounds?: TrackBounds, postLine?: Array<[number, number]>, forests?: ForestMass[], treeSpecies?: TreeSpeciesSpec[]) {
    this.bounds = bounds ?? { minX: -22, maxX: 22, minZ: -50, maxZ: 90 };
    this.postLine = postLine ?? defaultPostLine();
    this.forests = forests ?? [];
    this.treeSpecies = treeSpecies?.length ? treeSpecies : MONZA_TREE_SPECIES;
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
    // Monza sits on the flat Lombard plain — the "hills" are really a low, distant
    // tree-line ringing the park, not mountains. Center the ring on the circuit and keep
    // it broad and shallow so it reads as a wooded horizon under the haze.
    const ringCx = (this.bounds.minX + this.bounds.maxX) / 2;
    const ringCz = (this.bounds.minZ + this.bounds.maxZ) / 2;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const dist = SCENERY.HILL_RADIUS * (0.85 + rng() * 0.4);
      const radius = SCENERY.HILL_MIN_R + rng() * (SCENERY.HILL_MAX_R - SCENERY.HILL_MIN_R);
      const height = radius * (0.18 + rng() * 0.16); // shallow: a tree-line, not a peak
      pos.set(ringCx + Math.cos(ang) * dist, height * 0.5 - 3, ringCz + Math.sin(ang) * dist);
      scl.set(radius, height, radius);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** Broadleaf park woodland: trunks plus alpha-tested billboard canopy chunks. */
  private buildForest(rng: () => number): void {
    const count = SCENERY.TREE_COUNT;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
    const billboardGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.disposables.push(trunkGeo, billboardGeo);

    const trunks = new THREE.InstancedMesh(trunkGeo, this.trunkMaterial(), count);
    trunks.name = 'scenery-tree-trunks';
    trunks.castShadow = false; // distant; shadows would thrash the shadow atlas for no gain
    trunks.receiveShadow = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const clearance = SCENERY.TREE_CORRIDOR_HALF; // keep trees this far off the ribbon edge
    // Area-weighted picker over the real Parco di Monza woodland masses (from OSM). When
    // no masses are supplied, fall back to a uniform scatter over the footprint.
    const useMasses = this.forests.length > 0;
    const fallback = (() => {
      const fcx = (this.bounds.minX + this.bounds.maxX) / 2;
      const fcz = (this.bounds.minZ + this.bounds.maxZ) / 2;
      const fhalf = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ) / 2 + SCENERY.TREE_OUTER_R;
      return { fcx, fcz, fhalf };
    })();
    const cumAreas: number[] = [];
    let areaSum = 0;
    for (const f of this.forests) { areaSum += f.hx * f.hz; cumAreas.push(areaSum); }
    const speciesCum: number[] = [];
    let speciesWeight = 0;
    for (const s of this.treeSpecies) { speciesWeight += Math.max(0.001, s.weight); speciesCum.push(speciesWeight); }
    const billboards = new Map<string, Array<{ x: number; z: number; height: number; yaw: number; species: TreeSpeciesSpec }>>();

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 12) {
      guard++;
      let x: number, z: number;
      let massIndex = 0;
      if (useMasses) {
        // Pick a mass by area, then a point inside it (corners slightly soft so the
        // wood reads organic, not a hard rectangle).
        const r = rng() * areaSum;
        let fi = 0; while (fi < cumAreas.length - 1 && r > cumAreas[fi]) fi++;
        massIndex = fi;
        const f = this.forests[fi];
        x = f.cx + (rng() * 2 - 1) * f.hx * 1.06;
        z = f.cz + (rng() * 2 - 1) * f.hz * 1.06;
      } else {
        x = fallback.fcx + (rng() * 2 - 1) * fallback.fhalf;
        z = fallback.fcz + (rng() * 2 - 1) * fallback.fhalf;
      }
      // Never drop a tree on the racing surface or its immediate verge. Quick bbox
      // reject first, then the precise distance-to-ribbon test.
      if (
        x > this.bounds.minX - clearance && x < this.bounds.maxX + clearance &&
        z > this.bounds.minZ - clearance && z < this.bounds.maxZ + clearance &&
        this.onRibbon(x, z, clearance)
      ) continue;

      const species = this.pickSpecies(rng, speciesCum, speciesWeight);
      const scale = species.minHeight + rng() * (species.maxHeight - species.minHeight);
      const yaw = rng() * Math.PI * 2;
      q.setFromAxisAngle(UP, yaw);

      const trunkH = scale * 0.42;
      pos.set(x, trunkH * 0.5, z);
      scl.set(scale * 0.5, trunkH, scale * 0.5);
      m.compose(pos, q, scl);
      trunks.setMatrixAt(placed, m);

      const key = `${massIndex}:${species.id}`;
      const chunk = billboards.get(key) ?? [];
      chunk.push({ x, z, height: scale, yaw, species });
      billboards.set(key, chunk);

      placed++;
    }
    // If the corridor rejection left unused instances, collapse them to zero scale.
    for (let i = placed; i < count; i++) {
      m.compose(ZERO, q, ZERO_SCALE);
      trunks.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingBox();
    trunks.computeBoundingSphere();
    this.group.add(trunks);

    for (const [key, trees] of billboards) {
      const species = trees[0]?.species;
      if (!species) continue;
      const material = this.billboardMaterial(species);
      const mesh = new THREE.InstancedMesh(billboardGeo, material, trees.length);
      mesh.name = `scenery-tree-billboard-${key.replace(':', '-')}`;
      mesh.userData.speciesId = species.id;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      trees.forEach((tree, i) => {
        q.setFromAxisAngle(UP, tree.yaw);
        pos.set(tree.x, tree.height * 0.58, tree.z);
        scl.set(tree.height * species.crownWidth, tree.height, 1);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  private pickSpecies(rng: () => number, cumWeights: number[], total: number): TreeSpeciesSpec {
    const r = rng() * total;
    let i = 0;
    while (i < cumWeights.length - 1 && r > cumWeights[i]) i++;
    return this.treeSpecies[i] ?? this.treeSpecies[0];
  }

  /** True if (x,z) is within `margin` metres of the track ribbon centerline. */
  private onRibbon(x: number, z: number, margin: number): boolean {
    const line = this.postLine;
    if (line.length < 2) return false;
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const [bx, bz] = line[i];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      if (Math.hypot(x - px, z - pz) <= margin) return true;
    }
    return false;
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

  private billboardMaterial(species: TreeSpeciesSpec): THREE.Material {
    const texture = makeTreeBillboardTexture(species);
    this.disposables.push(texture);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: texture,
      alphaTest: 0.34,
      transparent: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
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

function makeTreeBillboardTexture(species: TreeSpeciesSpec): THREE.Texture {
  const width = 64;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  const canopy = new THREE.Color(species.canopyColor);
  const highlight = new THREE.Color(species.highlightColor);
  const trunk = new THREE.Color(species.trunkColor);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const idx = (y * width + x) * 4;
      const trunkMask = Math.abs(u - 0.5) < 0.055 && v < 0.5;
      const crownA = ellipse(u, v, 0.5, 0.58, 0.42, 0.35);
      const crownB = ellipse(u, v, 0.36, 0.72, 0.24, 0.22);
      const crownC = ellipse(u, v, 0.64, 0.71, 0.24, 0.22);
      const crownD = ellipse(u, v, 0.5, 0.86, 0.29, 0.18);
      const crown = Math.max(crownA, crownB, crownC, crownD);
      if (crown > 0) {
        const shade = 0.62 + 0.38 * Math.max(0, 1 - Math.hypot(u - 0.38, v - 0.78) * 2.1);
        const color = canopy.clone().lerp(highlight, shade * 0.55);
        data[idx] = Math.round(color.r * 255);
        data[idx + 1] = Math.round(color.g * 255);
        data[idx + 2] = Math.round(color.b * 255);
        data[idx + 3] = Math.round(255 * Math.min(1, crown * 1.4));
      } else if (trunkMask) {
        data[idx] = Math.round(trunk.r * 255);
        data[idx + 1] = Math.round(trunk.g * 255);
        data[idx + 2] = Math.round(trunk.b * 255);
        data[idx + 3] = 235;
      }
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function ellipse(u: number, v: number, cx: number, cy: number, rx: number, ry: number): number {
  const d = ((u - cx) * (u - cx)) / (rx * rx) + ((v - cy) * (v - cy)) / (ry * ry);
  return d < 1 ? 1 - d : 0;
}
