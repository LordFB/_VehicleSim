import * as THREE from 'three';
import type { BarrierSpec, TerrainTrackSample } from '../sim/types';
import {
  TERRAIN_CORRIDOR_HALF_WIDTH,
  roadSurfaceHeight,
  terrainNoise,
  terrainSurfaceHeight,
} from '../sim/runtime/TerrainSurface';

export { roadSurfaceHeight } from '../sim/runtime/TerrainSurface';

const ROAD_BANDS = [-1, -0.72, -0.38, 0, 0.38, 0.72, 1] as const;
const TERRAIN_OUTER_OFFSET = TERRAIN_CORRIDOR_HALF_WIDTH;

export type GeneratedMeshAsset = {
  object: THREE.Object3D;
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
};

export function createDetailedRoadGeometry(
  samples: TerrainTrackSample[],
  halfWidth: number,
  yOffset = 0.012,
): THREE.BufferGeometry {
  const n = samples.length;
  const bands = ROAD_BANDS.length;
  const positions = new Float32Array((n + 1) * bands * 3);
  const uvs = new Float32Array((n + 1) * bands * 2);
  let distance = 0;

  for (let i = 0; i <= n; i += 1) {
    const j = i % n;
    const sample = samples[j];
    if (i > 0) {
      const prev = samples[(i - 1) % n];
      distance += Math.hypot(sample.pos[0] - prev.pos[0], sample.pos[1] - prev.pos[1]);
    }

    ROAD_BANDS.forEach((band, b) => {
      const lateral = band * halfWidth;
      const x = sample.pos[0] + sample.left[0] * lateral;
      const z = sample.pos[1] + sample.left[1] * lateral;
      const base = (i * bands + b) * 3;
      positions[base + 0] = x;
      positions[base + 1] = roadSurfaceHeight(sample, lateral, halfWidth) + yOffset;
      positions[base + 2] = z;

      const uv = (i * bands + b) * 2;
      uvs[uv + 0] = (band + 1) * 0.5;
      uvs[uv + 1] = distance / 8;
    });
  }

  const indices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let b = 0; b < bands - 1; b += 1) {
      const a = i * bands + b;
      const c = (i + 1) * bands + b;
      const d = (i + 1) * bands + b + 1;
      const e = i * bands + b + 1;
      indices.push(a, c, e, e, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createTerrainCorridorGeometry(
  samples: TerrainTrackSample[],
  halfWidth: number,
  shoulderWidth: number,
): THREE.BufferGeometry {
  const rightOffsets = [
    -TERRAIN_OUTER_OFFSET,
    -78,
    -44,
    -24,
    -halfWidth - shoulderWidth,
    -halfWidth - 0.15,
  ];
  const leftOffsets = [
    halfWidth + 0.15,
    halfWidth + shoulderWidth,
    24,
    44,
    78,
    TERRAIN_OUTER_OFFSET,
  ];

  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  appendTerrainStrip(samples, halfWidth, shoulderWidth, rightOffsets, positions, colors, uvs, indices);
  appendTerrainStrip(samples, halfWidth, shoulderWidth, leftOffsets, positions, colors, uvs, indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Render a barrier run, choosing geometry per BarrierSpec.kind so a concrete
// wall, a tire wall and a steel guardrail read as themselves at speed — not one
// grey box. Barriers are bucketed by kind and each bucket gets its own light,
// instanced visual (a couple of draw calls per kind). Unkinded barriers default
// to Armco, so existing tracks (Nordschleife/Monza) are unchanged.
export function createArmcoBarrierVisuals(barriers: BarrierSpec[]): GeneratedMeshAsset {
  const group = new THREE.Group();
  group.name = 'generated-barriers';
  const disposables: GeneratedMeshAsset['disposables'] = [];

  const armco: BarrierSpec[] = [];
  const solid: BarrierSpec[] = [];
  const tire: BarrierSpec[] = [];
  for (const barrier of barriers) {
    if (barrier.kind === 'solid') solid.push(barrier);
    else if (barrier.kind === 'tirewall') tire.push(barrier);
    else armco.push(barrier);
  }

  if (armco.length > 0) addArmco(group, disposables, armco);
  if (solid.length > 0) addConcrete(group, disposables, solid);
  if (tire.length > 0) addTireWall(group, disposables, tire);

  return { object: group, disposables };
}

// Galvanized steel guardrail: twin rails + dark posts. The reference look — a
// continuous wavy beam stood off on slim posts.
function addArmco(group: THREE.Group, disposables: GeneratedMeshAsset['disposables'], barriers: BarrierSpec[]): void {
  const visualStride = barriers.length > 8000 ? 2 : 1;
  const visualBarriers = visualStride === 1 ? barriers : barriers.filter((_, i) => i % visualStride === 0);

  const railGeometry = new THREE.BoxGeometry(0.18, 0.12, 3.2);
  const postGeometry = new THREE.CylinderGeometry(0.055, 0.075, 1.05, 7);
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x9ca5ad, roughness: 0.34, metalness: 0.62 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x343a42, roughness: 0.55, metalness: 0.38 });

  const rails = new THREE.InstancedMesh(railGeometry, railMaterial, visualBarriers.length * 2);
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, visualBarriers.length);
  rails.name = 'armco-rails';
  posts.name = 'armco-posts';
  rails.castShadow = false;
  posts.castShadow = false;
  rails.receiveShadow = true;
  posts.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  let railIndex = 0;

  visualBarriers.forEach((barrier, i) => {
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), barrier.yawRad ?? 0);
    scale.set(1, 1, Math.max(0.35, (barrier.halfExtents[2] * 2 * visualStride) / 3.2));
    for (const railYOffset of [-0.15, 0.24]) {
      position.set(barrier.center[0], barrier.center[1] + railYOffset, barrier.center[2]);
      matrix.compose(position, rotation, scale);
      rails.setMatrixAt(railIndex, matrix);
      railIndex += 1;
    }
    position.set(barrier.center[0], barrier.center[1] - 0.1, barrier.center[2]);
    matrix.compose(position, rotation, scale);
    posts.setMatrixAt(i, matrix);
  });

  rails.instanceMatrix.needsUpdate = true;
  posts.instanceMatrix.needsUpdate = true;
  group.add(rails, posts);
  disposables.push(railGeometry, postGeometry, railMaterial, postMaterial);
}

// Concrete Jersey/K-rail: a continuous solid parapet — warm light grey, matte,
// no metalness. A single instanced box scaled to each segment reads as a poured
// wall, with a thin red-white top cap stripe for the racetrack look.
function addConcrete(group: THREE.Group, disposables: GeneratedMeshAsset['disposables'], barriers: BarrierSpec[]): void {
  const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
  const capGeometry = new THREE.BoxGeometry(1, 1, 1);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xcdc8bd, roughness: 0.92, metalness: 0.0 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xb23b32, roughness: 0.7, metalness: 0.0 });

  const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, barriers.length);
  const cap = new THREE.InstancedMesh(capGeometry, capMaterial, barriers.length);
  body.name = 'concrete-wall';
  cap.name = 'concrete-cap';
  body.castShadow = true;
  body.receiveShadow = true;
  cap.castShadow = false;
  cap.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  barriers.forEach((barrier, i) => {
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), barrier.yawRad ?? 0);
    const length = barrier.halfExtents[2] * 2 + 0.06; // small overlap closes seams
    const fullH = barrier.halfExtents[1] * 2;
    // Body: slightly wider than the collision box so it visually reads as solid.
    scale.set(0.42, fullH, length);
    position.set(barrier.center[0], barrier.center[1], barrier.center[2]);
    matrix.compose(position, rotation, scale);
    body.setMatrixAt(i, matrix);
    // Cap stripe sitting on top.
    scale.set(0.46, 0.1, length);
    position.set(barrier.center[0], barrier.center[1] + barrier.halfExtents[1], barrier.center[2]);
    matrix.compose(position, rotation, scale);
    cap.setMatrixAt(i, matrix);
  });

  body.instanceMatrix.needsUpdate = true;
  cap.instanceMatrix.needsUpdate = true;
  group.add(body, cap);
  disposables.push(bodyGeometry, capGeometry, bodyMaterial, capMaterial);
}

// Tire wall: a run of dark rubber tyres. The signature is *repeated round tyre
// faces* — a single smooth tube reads as a pipe, so we lay a discrete torus
// (an actual tyre ring) every ~0.7 m along the barrier. Tori are pre-counted
// across all barriers and packed into one instanced mesh, so the whole wall is
// still a single draw call however long it is.
const TYRE_SPACING = 0.7;
const TYRE_RADIUS = 0.42;

function addTireWall(group: THREE.Group, disposables: GeneratedMeshAsset['disposables'], barriers: BarrierSpec[]): void {
  // Torus lies in the XY plane (hole faces +Z); we want the hole to face along
  // the run, so it's already oriented once we yaw by the barrier heading.
  const tyreGeometry = new THREE.TorusGeometry(TYRE_RADIUS, 0.17, 8, 14);
  const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.95, metalness: 0.0 });

  // Count tyres per barrier first so the instanced mesh is sized exactly.
  const counts = barriers.map((b) => Math.max(1, Math.round((b.halfExtents[2] * 2) / TYRE_SPACING)));
  const total = counts.reduce((sum, n) => sum + n, 0);
  const tyres = new THREE.InstancedMesh(tyreGeometry, tyreMaterial, total);
  tyres.name = 'tire-wall';
  tyres.castShadow = true;
  tyres.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const forward = new THREE.Vector3();
  let index = 0;

  barriers.forEach((barrier, b) => {
    const yaw = barrier.yawRad ?? 0;
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    // Unit vector along the barrier's length (its local +Z after yaw).
    forward.set(Math.sin(yaw), 0, Math.cos(yaw));
    const count = counts[b];
    const length = barrier.halfExtents[2] * 2;
    const start = -length / 2 + length / (count * 2);
    for (let t = 0; t < count; t += 1) {
      const along = start + (length / count) * t;
      position.set(
        barrier.center[0] + forward.x * along,
        barrier.center[1],
        barrier.center[2] + forward.z * along,
      );
      matrix.compose(position, rotation, one);
      tyres.setMatrixAt(index, matrix);
      index += 1;
    }
  });

  tyres.instanceMatrix.needsUpdate = true;
  group.add(tyres);
  disposables.push(tyreGeometry, tyreMaterial);
}

function appendTerrainStrip(
  samples: TerrainTrackSample[],
  halfWidth: number,
  shoulderWidth: number,
  offsets: number[],
  positions: number[],
  colors: number[],
  uvs: number[],
  indices: number[],
): void {
  const start = positions.length / 3;
  let distance = 0;
  const rows = samples.length + 1;
  const cols = offsets.length;

  for (let i = 0; i < rows; i += 1) {
    const sample = samples[i % samples.length];
    if (i > 0) {
      const prev = samples[(i - 1) % samples.length];
      distance += Math.hypot(sample.pos[0] - prev.pos[0], sample.pos[1] - prev.pos[1]);
    }
    for (const lateral of offsets) {
      const x = sample.pos[0] + sample.left[0] * lateral;
      const z = sample.pos[1] + sample.left[1] * lateral;
      const y = terrainSurfaceHeight(sample, lateral, halfWidth, shoulderWidth, x, z);
      positions.push(x, y, z);
      pushTerrainColor(colors, lateral, halfWidth, shoulderWidth, x, z);
      uvs.push(Math.abs(lateral) / TERRAIN_OUTER_OFFSET, distance / 35);
    }
  }

  for (let i = 0; i < rows - 1; i += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = start + i * cols + c;
      const b = start + i * cols + c + 1;
      const d = start + (i + 1) * cols + c;
      const e = start + (i + 1) * cols + c + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
}

function pushTerrainColor(
  colors: number[],
  lateral: number,
  halfWidth: number,
  shoulderWidth: number,
  x: number,
  z: number,
): void {
  const abs = Math.abs(lateral);
  const color = new THREE.Color();
  const n = terrainNoise(x + 3, z - 11, 24);
  if (abs <= halfWidth + shoulderWidth + 0.5) {
    color.setRGB(0.56 + n * 0.035, 0.52 + n * 0.03, 0.41 + n * 0.025);
  } else {
    const forest = smoothstep(42, 95, abs);
    color.setRGB(
      THREE.MathUtils.lerp(0.22 + n * 0.035, 0.12 + n * 0.02, forest),
      THREE.MathUtils.lerp(0.43 + n * 0.045, 0.29 + n * 0.03, forest),
      THREE.MathUtils.lerp(0.17 + n * 0.025, 0.12 + n * 0.02, forest),
    );
  }
  colors.push(color.r, color.g, color.b);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
