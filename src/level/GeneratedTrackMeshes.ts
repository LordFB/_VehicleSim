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

export function createArmcoBarrierVisuals(barriers: BarrierSpec[]): GeneratedMeshAsset {
  const group = new THREE.Group();
  group.name = 'generated-armco-guardrails';
  const visualStride = barriers.length > 8000 ? 2 : 1;
  const visualBarriers = visualStride === 1 ? barriers : barriers.filter((_, i) => i % visualStride === 0);

  const railGeometry = new THREE.BoxGeometry(0.18, 0.12, 3.2);
  const postGeometry = new THREE.CylinderGeometry(0.055, 0.075, 1.05, 7);
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ca5ad,
    roughness: 0.34,
    metalness: 0.62,
  });
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0x343a42,
    roughness: 0.55,
    metalness: 0.38,
  });

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
    const yaw = barrier.yawRad ?? 0;
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    scale.set(1, 1, Math.max(0.35, barrier.halfExtents[2] * 2 * visualStride / 3.2));
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

  return {
    object: group,
    disposables: [railGeometry, postGeometry, railMaterial, postMaterial],
  };
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
