import * as THREE from 'three';
import type {
  SerializableTrackPrintSurface,
  SerializableTrackPrintSurfaceBand,
  SerializableTrackPrintTerrainMesh,
} from './TrackDefinition';
import type { TerrainTrackSample } from '../sim/types';

const TERRAIN_BASE_COLOR = new THREE.Color('#3d7dd1');
const TERRAIN_GRID_COLOR = new THREE.Color('#f4faff');
const TERRAIN_LIGHT_DIR = new THREE.Vector3(0.55, 0.85, 0.35).normalize();

export function createTrackPrintTerrainVisual(
  terrain: SerializableTrackPrintTerrainMesh,
  skirt?: SerializableTrackPrintTerrainMesh,
  clip?: { samples: TerrainTrackSample[]; halfWidth: number },
): { object: THREE.Object3D; disposables: Array<THREE.BufferGeometry | THREE.Material> } {
  const group = new THREE.Group();
  group.name = 'trackprint-terrain-root';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  if (terrain.indices.length > 0) {
    const terrainMesh = createSchematicMesh(terrain, 2, 2, clip);
    terrainMesh.name = 'trackprint-terrain';
    terrainMesh.renderOrder = -3;
    group.add(terrainMesh);
    disposables.push(terrainMesh.geometry, terrainMesh.material as THREE.Material);
  }
  if (skirt && skirt.indices.length > 0) {
    const skirtMesh = createSchematicMesh(skirt, -0.5, -0.5);
    skirtMesh.name = 'trackprint-terrain-skirt';
    skirtMesh.renderOrder = -2;
    group.add(skirtMesh);
    disposables.push(skirtMesh.geometry, skirtMesh.material as THREE.Material);
  }
  return { object: group, disposables };
}

export function createTrackPrintAsphaltMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: 0x1d7fff,
    emissive: 0x0e5bd4,
    emissiveIntensity: 0.18,
    metalness: 0,
    roughness: 0.68,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function createTrackPrintSurfaceVisual(
  surface: SerializableTrackPrintSurface,
): { object: THREE.Object3D; disposables: Array<THREE.BufferGeometry | THREE.Material> } {
  const group = new THREE.Group();
  group.name = 'trackprint-surface-root';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  if (surface.asphalt.indices.length > 0) {
    const asphaltMaterial = createTrackPrintAsphaltMaterial();
    const asphalt = createSurfaceMesh(surface.asphalt, asphaltMaterial);
    asphalt.name = 'trackprint-asphalt';
    asphalt.renderOrder = 2;
    asphalt.receiveShadow = true;
    group.add(asphalt);
    disposables.push(asphalt.geometry, asphaltMaterial);
  }

  for (const band of surface.bands) {
    if (band.indices.length === 0) continue;
    const material = createBandMaterial(band);
    const mesh = createSurfaceMesh(band, material);
    mesh.name = `trackprint-${band.material}`;
    mesh.renderOrder = 3;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(mesh.geometry, material);
  }

  return { object: group, disposables };
}

function createSurfaceMesh(
  mesh: SerializableTrackPrintTerrainMesh,
  material: THREE.Material,
): THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.indices), 1));
  if (!mesh.normals) geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function createBandMaterial(band: SerializableTrackPrintSurfaceBand): THREE.Material {
  const materialByBand: Record<SerializableTrackPrintSurfaceBand['material'], { color: number; emissive: number }> = {
    asphalt: { color: 0x1d7fff, emissive: 0x0e5bd4 },
    curbLeft: { color: 0xd9482e, emissive: 0x7a2017 },
    curbRight: { color: 0x2e8bd9, emissive: 0x164c7a },
    runoffLeft: { color: 0x69747a, emissive: 0x30383c },
    runoffRight: { color: 0x556f8c, emissive: 0x273a50 },
  };
  const colors = materialByBand[band.material];
  return new THREE.MeshStandardMaterial({
    color: colors.color,
    emissive: colors.emissive,
    emissiveIntensity: 0.12,
    metalness: 0,
    roughness: 0.8,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function createSchematicMesh(
  mesh: SerializableTrackPrintTerrainMesh,
  polygonOffsetFactor: number,
  polygonOffsetUnits: number,
  clip?: { samples: TerrainTrackSample[]; halfWidth: number },
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  if (mesh.normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  if (mesh.uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(clip ? clippedIndices(mesh, clip) : mesh.indices), 1));
  if (!mesh.normals) geometry.computeVertexNormals();
  const material = createTerrainShaderMaterial();
  material.polygonOffset = true;
  material.polygonOffsetFactor = polygonOffsetFactor;
  material.polygonOffsetUnits = polygonOffsetUnits;
  return new THREE.Mesh(geometry, material);
}

function clippedIndices(
  mesh: SerializableTrackPrintTerrainMesh,
  clip: { samples: TerrainTrackSample[]; halfWidth: number },
): number[] {
  const out: number[] = [];
  const keepClearance = clip.halfWidth + 0.8;
  const index = buildTrackIndex(clip.samples, Math.max(keepClearance * 2, 10));
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3;
    const b = mesh.indices[i + 1] * 3;
    const c = mesh.indices[i + 2] * 3;
    const x = (mesh.positions[a] + mesh.positions[b] + mesh.positions[c]) / 3;
    const z = (mesh.positions[a + 2] + mesh.positions[b + 2] + mesh.positions[c + 2]) / 3;
    if (distanceToTrackSqIndexed(x, z, clip.samples, index) > keepClearance * keepClearance) {
      out.push(mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]);
    }
  }
  return out;
}

type TrackIndex = {
  cellSize: number;
  buckets: Map<string, number[]>;
};

function buildTrackIndex(samples: TerrainTrackSample[], cellSize: number): TrackIndex {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < samples.length; i += 1) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const minX = Math.min(a.pos[0], b.pos[0]);
    const maxX = Math.max(a.pos[0], b.pos[0]);
    const minZ = Math.min(a.pos[1], b.pos[1]);
    const maxZ = Math.max(a.pos[1], b.pos[1]);
    for (let cx = Math.floor(minX / cellSize); cx <= Math.floor(maxX / cellSize); cx += 1) {
      for (let cz = Math.floor(minZ / cellSize); cz <= Math.floor(maxZ / cellSize); cz += 1) {
        const key = `${cx},${cz}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push(i);
        buckets.set(key, bucket);
      }
    }
  }
  return { cellSize, buckets };
}

function distanceToTrackSqIndexed(x: number, z: number, samples: TerrainTrackSample[], index: TrackIndex): number {
  const cx = Math.floor(x / index.cellSize);
  const cz = Math.floor(z / index.cellSize);
  const candidates = new Set<number>();
  for (let oz = -1; oz <= 1; oz += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const bucket = index.buckets.get(`${cx + ox},${cz + oz}`);
      if (!bucket) continue;
      for (const segmentIndex of bucket) candidates.add(segmentIndex);
    }
  }
  return distanceToTrackSq(x, z, samples, candidates.size > 0 ? candidates : undefined);
}

function distanceToTrackSq(x: number, z: number, samples: TerrainTrackSample[], candidates?: Iterable<number>): number {
  let best = Infinity;
  const indices = candidates ?? samples.keys();
  for (const i of indices) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const abx = b.pos[0] - a.pos[0];
    const abz = b.pos[1] - a.pos[1];
    const lenSq = abx * abx + abz * abz;
    const t = lenSq <= 1e-9 ? 0 : clamp(((x - a.pos[0]) * abx + (z - a.pos[1]) * abz) / lenSq, 0, 1);
    const px = a.pos[0] + abx * t;
    const pz = a.pos[1] + abz * t;
    const dx = x - px;
    const dz = z - pz;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createTerrainShaderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: TERRAIN_BASE_COLOR.clone() },
      uGridColor: { value: TERRAIN_GRID_COLOR.clone() },
      uLightDir: { value: TERRAIN_LIGHT_DIR.clone() },
      uMajorSpacing: { value: 20.0 },
      uMinorSpacing: { value: 5.0 },
      uMajorThickness: { value: 0.32 },
      uMinorThickness: { value: 0.14 },
      uMajorOpacity: { value: 0.6 },
      uMinorOpacity: { value: 0.22 },
      uToonSteps: { value: 3.0 },
      uShadowFloor: { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      uniform vec3 uBaseColor;
      uniform vec3 uGridColor;
      uniform vec3 uLightDir;
      uniform float uMajorSpacing;
      uniform float uMinorSpacing;
      uniform float uMajorThickness;
      uniform float uMinorThickness;
      uniform float uMajorOpacity;
      uniform float uMinorOpacity;
      uniform float uToonSteps;
      uniform float uShadowFloor;

      float gridMask(vec2 worldXZ, float spacing, float thickness) {
        vec2 cell = abs(fract(worldXZ / spacing - 0.5) - 0.5) * spacing;
        float aa = 0.35;
        vec2 line = smoothstep(thickness + aa, thickness - aa, cell);
        return max(line.x, line.y);
      }

      void main() {
        float ndotl = max(dot(normalize(vWorldNormal), uLightDir), 0.0);
        float bands = max(uToonSteps, 1.0);
        float stepped = floor(ndotl * bands) / bands;
        vec3 lit = uBaseColor * mix(uShadowFloor, 1.0, stepped);
        float minorMask = gridMask(vWorldPosition.xz, uMinorSpacing, uMinorThickness);
        float majorMask = gridMask(vWorldPosition.xz, uMajorSpacing, uMajorThickness);
        vec3 withMinor = mix(lit, uGridColor, minorMask * uMinorOpacity);
        vec3 finalColor = mix(withMinor, uGridColor, majorMask * uMajorOpacity);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
}
