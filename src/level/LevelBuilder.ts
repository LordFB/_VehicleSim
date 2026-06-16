import * as THREE from 'three';
import { COLORS } from '../core/Constants';
import type { TerrainTrackSample, WorldSpec } from '../sim/types';
import {
  createArmcoBarrierVisuals,
  createDetailedRoadGeometry,
  createTerrainCorridorGeometry,
  roadSurfaceHeight,
} from './GeneratedTrackMeshes';
import { createTrackPrintSurfaceVisual, createTrackPrintTerrainVisual } from './TrackPrintTerrainVisual';
import type { TrackFeatures } from './TrackDefinition';
import { TRACK_HALF_WIDTH } from './MonzaTrack';

/** Plain rectangle spec for the rendered start/finish line (purely cosmetic). */
export type StartFinishLine = {
  center: [number, number]; // x, z
  width: number; // across the track (x)
  depth: number; // along the track (z)
  headingRad: number;
};

/** Cosmetic spec for the abandoned banked oval (the sopraelevata). Purely visual. */
export type BankingSpec = {
  center: [number, number];
  radius: number;
  arcStartDeg: number;
  arcEndDeg: number;
  height: number;
  bankDeg: number;
};

/**
 * Renders the Monza circuit: a sunlit grass plane, the smooth asphalt ribbon swept
 * along the real centerline, red/white apex kerbs, gravel run-offs, the checkered
 * start/finish line and the boundary barriers. The drivable surface and grip come
 * entirely from the WorldSpec zones (built in MonzaWorld); the ribbon here is the
 * matching *visual* surface, swept as one smooth triangle strip so corners read curved
 * rather than stair-stepped.
 */
export class LevelBuilder {
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldSpec,
    private readonly startFinish: StartFinishLine,
    private readonly centerline: TerrainTrackSample[],
    private readonly trackHalfWidth = TRACK_HALF_WIDTH,
    private readonly features: TrackFeatures = {},
  ) {}

  build(): void {
    this.createGround();
    this.createTrackPrintTerrain();
    this.createGeneratedTerrain();
    this.createTrackPrintSurface();
    this.createShoulders();
    this.createRibbon();
    this.createEdgeLines();
    this.createGravel();
    this.createKerbs();
    this.createTerrainKerbs();
    this.createStartFinish();
    this.createBarriers();
    this.createBanking();
    this.createLandmarks();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  /** Large surrounding sunlit-grass plane so the world has a real horizon, not void. */
  private createGround(): void {
    if (this.features.generatedGround === false) return;
    const bounds = this.bounds();
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 600;
    const geometry = new THREE.PlaneGeometry(Math.max(4000, span), Math.max(4000, span), 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_FAR, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.x = (bounds.minX + bounds.maxX) / 2;
    mesh.position.z = (bounds.minZ + bounds.maxZ) / 2;
    mesh.position.y = this.world.terrainTrack ? this.averageElevation() - 2.5 : -0.06;
    mesh.receiveShadow = true;
    mesh.name = 'ground-plane';
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  private createGeneratedTerrain(): void {
    if (this.features.generatedTerrain === false) return;
    const terrain = this.world.terrainTrack;
    if (!terrain) return;
    const geometry = createTerrainCorridorGeometry(terrain.samples, terrain.halfWidth, terrain.shoulderWidth);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'generated-terrain-corridor';
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  private createTrackPrintTerrain(): void {
    const terrain = this.features.trackPrintTerrain;
    if (!terrain) return;
    const asset = createTrackPrintTerrainVisual(
      terrain,
      this.features.trackPrintSkirt,
      undefined,
      this.features.trackPrintTerrainTexture,
    );
    this.scene.add(asset.object);
    this.disposables.push(...asset.disposables);
  }

  private createTrackPrintSurface(): void {
    const surface = this.features.trackPrintSurface;
    if (!surface) return;
    const asset = createTrackPrintSurfaceVisual(surface);
    this.scene.add(asset.object);
    this.disposables.push(...asset.disposables);
  }

  /** The asphalt ribbon: one smooth triangle strip swept ±half-width along the centerline. */
  private createRibbon(): void {
    if (this.features.trackPrintSurface) return;
    const geometry = createDetailedRoadGeometry(this.centerline, this.trackHalfWidth);

    const texture = this.makeAsphaltTexture();
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.ASPHALT,
      roughness: 0.92,
      metalness: 0.04,
      map: texture,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = this.world.terrainTrack ? 'detailed-track-ribbon' : 'monza-ribbon';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  private createShoulders(): void {
    if (this.features.trackPrintSurface) return;
    const shoulder = this.world.terrainTrack?.shoulderWidth;
    if (!shoulder || shoulder <= 0) return;
    const material = new THREE.MeshStandardMaterial({
      color: this.features.textureStyle === 'trackprint' ? 0x69747a : COLORS.GRAVEL,
      emissive: this.features.textureStyle === 'trackprint' ? 0x34424a : 0x000000,
      emissiveIntensity: this.features.textureStyle === 'trackprint' ? 0.12 : 0,
      roughness: 0.98,
      metalness: 0,
    });
    this.disposables.push(material);
    for (const side of [-1, 1] as const) {
      const geometry = this.createOffsetStripGeometry(this.trackHalfWidth, this.trackHalfWidth + shoulder, side, 0.004);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = side > 0 ? 'left-shoulder' : 'right-shoulder';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.disposables.push(geometry);
    }
  }

  /** Thin white edge lines down both verges of the ribbon (track limits). */
  private createEdgeLines(): void {
    if (this.features.trackPrintSurface) return;
    const { left, right } = this.trackEdges();
    const material = new THREE.LineBasicMaterial({ color: COLORS.PAINT });
    this.disposables.push(material);
    for (const [edge, side] of [[left, 1], [right, -1]] as const) {
      const pts = edge.map(([x, z], i) => new THREE.Vector3(
        x,
        roadSurfaceHeight(this.centerline[i], this.trackHalfWidth * side, this.trackHalfWidth) + 0.035,
        z,
      ));
      pts.push(pts[0].clone());
      const geometry = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geometry, material);
      line.name = 'track-edge';
      this.scene.add(line);
      this.disposables.push(geometry);
    }
  }

  /** Gravel run-off patches from the world's gravel zones (circles). */
  private createGravel(): void {
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRAVEL, roughness: 0.98, metalness: 0 });
    this.disposables.push(material);
    for (const zone of this.world.zones) {
      if (zone.materialId !== 'gravel' || zone.type !== 'circle' || !zone.radius) continue;
      const geometry = new THREE.CircleGeometry(zone.radius, 28);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(zone.center[0], (zone.heightOffset ?? 0) + 0.012, zone.center[1]);
      mesh.receiveShadow = true;
      mesh.name = `gravel-${zone.id}`;
      this.scene.add(mesh);
      this.disposables.push(geometry);
    }
  }

  /** Red/white sawtooth apex kerbs from the world's kerb zones. */
  private createKerbs(): void {
    for (const zone of this.world.zones) {
      if (zone.materialId !== 'kerb' || zone.type !== 'rect' || !zone.size) continue;
      this.createKerb(zone.id, zone.center, zone.size, zone.heightOffset ?? 0);
    }
  }

  private createTerrainKerbs(): void {
    if (this.features.generatedKerbs === false) return;
    if (!this.world.terrainTrack) return;
    const candidates = this.centerline
      .slice(0, -1)
      .filter((p, i) => i % 8 === 0 && Math.abs(p.curvature) > 0.025);
    if (candidates.length === 0) return;
    const geometry = new THREE.BoxGeometry(1.0, 0.06, 1.4);
    const redMat = new THREE.MeshStandardMaterial({ color: COLORS.KERB_RED, roughness: 0.72 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: COLORS.KERB_WHITE, roughness: 0.72 });
    const red = new THREE.InstancedMesh(geometry, redMat, Math.ceil(candidates.length / 2));
    const white = new THREE.InstancedMesh(geometry, whiteMat, Math.floor(candidates.length / 2));
    red.name = 'terrain-kerbs-red';
    white.name = 'terrain-kerbs-white';
    red.castShadow = white.castShadow = true;
    red.receiveShadow = white.receiveShadow = true;
    this.disposables.push(geometry, redMat, whiteMat);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let ri = 0, wi = 0;
    candidates.forEach((p, i) => {
      const insideSign = p.curvature < 0 ? -1 : 1;
      const off = this.trackHalfWidth - 0.25;
      pos.set(p.pos[0] + p.left[0] * off * insideSign, p.elevation + 0.055, p.pos[1] + p.left[1] * off * insideSign);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.tangent[0], p.tangent[1]));
      m.compose(pos, q, one);
      if (i % 2 === 0) red.setMatrixAt(ri++, m);
      else white.setMatrixAt(wi++, m);
    });
    red.instanceMatrix.needsUpdate = true;
    white.instanceMatrix.needsUpdate = true;
    this.scene.add(red, white);
  }

  /** Alternating red/white segments along a rectangular kerb zone. */
  private createKerb(id: string, center: [number, number], size: [number, number], heightOffset: number): void {
    const group = new THREE.Group();
    group.name = `kerb-${id}`;
    const along = Math.max(size[0], size[1]);
    const across = Math.min(size[0], size[1]);
    const alongIsZ = size[1] >= size[0];
    const segLen = 0.8;
    const count = Math.max(1, Math.round(along / segLen));
    const actualLen = along / count;
    const redMat = new THREE.MeshStandardMaterial({ color: COLORS.KERB_RED, roughness: 0.7 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: COLORS.KERB_WHITE, roughness: 0.7 });
    this.disposables.push(redMat, whiteMat);
    const geometry = alongIsZ
      ? new THREE.BoxGeometry(across, 0.06, actualLen)
      : new THREE.BoxGeometry(actualLen, 0.06, across);
    this.disposables.push(geometry);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, i % 2 === 0 ? redMat : whiteMat);
      const t = -along / 2 + actualLen * (i + 0.5);
      if (alongIsZ) mesh.position.set(center[0], heightOffset + 0.03, center[1] + t);
      else mesh.position.set(center[0] + t, heightOffset + 0.03, center[1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.scene.add(group);
  }

  private createStartFinish(): void {
    const sf = this.startFinish;
    const texture = this.makeCheckerTexture();
    const geometry = new THREE.PlaneGeometry(sf.width, sf.depth);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.6,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -sf.headingRad;
    mesh.position.set(sf.center[0], this.nearestRoadHeight(sf.center[0], sf.center[1]) + 0.04, sf.center[1]);
    mesh.name = 'start-finish-line';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  /**
   * The sopraelevata — Monza's abandoned 1955 banked oval, which still stands in the
   * park. Built here as a cosmetic weathered-concrete banked arc: a curved strip that
   * rises and tilts outward. Purely visual (no collision), so it can't affect physics.
   */
  private createBanking(): void {
    const b = this.features.banking;
    if (!b) return;
    const segments = 48;
    const a0 = (b.arcStartDeg * Math.PI) / 180;
    const a1 = (b.arcEndDeg * Math.PI) / 180;
    const bank = (b.bankDeg * Math.PI) / 180;
    const stripWidth = b.height / Math.sin(bank); // slant length of the banked face
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const ang = a0 + (a1 - a0) * t;
      const cx = b.center[0] + Math.cos(ang) * b.radius;
      const cz = b.center[1] + Math.sin(ang) * b.radius;
      // Outward radial direction (the bank leans up-and-out from the inner foot).
      const rx = Math.cos(ang), rz = Math.sin(ang);
      // Inner foot at ground, outer lip raised by height and pushed out horizontally.
      const outX = Math.cos(bank) * stripWidth;
      positions.push(cx, 0.02, cz); // inner foot
      positions.push(cx + rx * outX, b.height, cz + rz * outX); // outer lip
      uvs.push(t * 14, 0, t * 14, 1);
    }
    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2, bb = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, bb, bb, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0x9a958c, // weathered concrete
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'sopraelevata-banking';
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  private createBarriers(): void {
    const boxes = this.world.barriers;
    if (boxes.length === 0) return;
    if (this.world.terrainTrack) {
      const asset = createArmcoBarrierVisuals(boxes);
      this.scene.add(asset.object);
      this.disposables.push(...asset.disposables);
      return;
    }

    const material = new THREE.MeshStandardMaterial({ color: COLORS.BARRIER, roughness: 0.7, metalness: 0.1 });
    this.disposables.push(material);
    // Barriers repeat in their hundreds around the ribbon — instance them so the
    // boundary costs a couple of draw calls, not one per wall (threejs-perf).
    // Group by footprint so identical-extent boxes share an InstancedMesh.
    const byKey = new Map<string, typeof boxes>();
    for (const b of boxes) {
      const key = b.halfExtents.join(',');
      const arr = byKey.get(key) ?? [];
      arr.push(b);
      byKey.set(key, arr);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    let g = 0;
    for (const [key, arr] of byKey) {
      const [hx, hy, hz] = key.split(',').map(Number);
      const geometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      this.disposables.push(geometry);
      const inst = new THREE.InstancedMesh(geometry, material, arr.length);
      inst.name = `barriers-${g++}`;
      inst.castShadow = true;
      inst.receiveShadow = true;
      arr.forEach((b, i) => {
        pos.set(b.center[0], b.center[1], b.center[2]);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yawRad ?? 0);
        m.compose(pos, q, one);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }
  }

  private createLandmarks(): void {
    const landmarks = this.features.landmarks ?? [];
    if (landmarks.length === 0) return;
    const postGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);
    const signGeo = new THREE.BoxGeometry(3.2, 0.9, 0.12);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.6 });
    this.disposables.push(postGeo, signGeo, postMat);
    for (const landmark of landmarks) {
      const group = new THREE.Group();
      group.name = `landmark-${landmark.name}`;
      group.position.set(landmark.position[0], landmark.position[1], landmark.position[2]);
      group.rotation.y = landmark.yawRad;

      const texture = this.makeSignTexture(landmark.name);
      const signMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.05 });
      this.disposables.push(texture, signMat);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = -0.75;
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.y = 0.3;
      post.castShadow = sign.castShadow = true;
      post.receiveShadow = sign.receiveShadow = true;
      group.add(post, sign);
      this.scene.add(group);
    }
  }

  private trackEdges(): { left: Array<[number, number]>; right: Array<[number, number]> } {
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    for (const p of this.centerline) {
      left.push([p.pos[0] + p.left[0] * this.trackHalfWidth, p.pos[1] + p.left[1] * this.trackHalfWidth]);
      right.push([p.pos[0] - p.left[0] * this.trackHalfWidth, p.pos[1] - p.left[1] * this.trackHalfWidth]);
    }
    return { left, right };
  }

  private createOffsetStripGeometry(inner: number, outer: number, side: -1 | 1, yOffset: number): THREE.BufferGeometry {
    const n = this.centerline.length;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    let acc = 0;
    for (let i = 0; i <= n; i += 1) {
      const j = i % n;
      const p = this.centerline[j];
      if (i > 0) {
        const prev = this.centerline[(i - 1) % n];
        acc += Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1]);
      }
      const ix = p.pos[0] + p.left[0] * inner * side;
      const iz = p.pos[1] + p.left[1] * inner * side;
      const ox = p.pos[0] + p.left[0] * outer * side;
      const oz = p.pos[1] + p.left[1] * outer * side;
      const base = i * 2 * 3;
      positions[base + 0] = ix; positions[base + 1] = roadSurfaceHeight(p, inner * side, this.trackHalfWidth) + yOffset; positions[base + 2] = iz;
      positions[base + 3] = ox; positions[base + 4] = roadSurfaceHeight(p, outer * side, this.trackHalfWidth) + yOffset; positions[base + 5] = oz;
      const ub = i * 2 * 2;
      uvs[ub + 0] = 0; uvs[ub + 1] = acc / 10;
      uvs[ub + 2] = 1; uvs[ub + 3] = acc / 10;
    }
    const indices: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private nearestRoadHeight(x: number, z: number): number {
    let best = this.centerline[0];
    let bestDistanceSq = Infinity;
    for (const sample of this.centerline) {
      const dx = x - sample.pos[0];
      const dz = z - sample.pos[1];
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        best = sample;
      }
    }
    return roadSurfaceHeight(best, 0, this.trackHalfWidth);
  }

  private averageElevation(): number {
    let sum = 0;
    for (const sample of this.centerline) sum += sample.elevation;
    return sum / Math.max(1, this.centerline.length);
  }

  private bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.centerline) {
      minX = Math.min(minX, p.pos[0]);
      maxX = Math.max(maxX, p.pos[0]);
      minZ = Math.min(minZ, p.pos[1]);
      maxZ = Math.max(maxZ, p.pos[1]);
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Subtle procedural asphalt: faint mottled noise so the road isn't a flat slab. */
  private makeAsphaltTexture(): THREE.Texture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#24262b';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 22000; i++) {
      const x = seededUnit(i * 17 + 5) * size;
      const y = seededUnit(i * 31 + 11) * size;
      const v = 18 + Math.floor(seededUnit(i * 7 + 3) * 36);
      const a = 0.11 + seededUnit(i * 13 + 19) * 0.23;
      ctx.fillStyle = `rgba(${v},${v},${v + 3},${a})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    ctx.fillStyle = 'rgba(5,6,8,0.18)';
    ctx.fillRect(size * 0.3, 0, size * 0.07, size);
    ctx.fillRect(size * 0.63, 0, size * 0.07, size);
    ctx.fillStyle = 'rgba(230,232,220,0.055)';
    ctx.fillRect(5, 0, 5, size);
    ctx.fillRect(size - 10, 0, 5, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 3);
    texture.anisotropy = 8;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private makeCheckerTexture(): THREE.Texture {
    const cells = 8;
    const px = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const s = px / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f6f8' : '#15171b';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private makeSignTexture(label: string): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 144;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#15171b';
    ctx.fillRect(14, 14, canvas.width - 28, canvas.height - 28);
    ctx.fillStyle = '#f4f6f8';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.toUpperCase(), canvas.width / 2, canvas.height / 2, canvas.width - 58);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}

function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
