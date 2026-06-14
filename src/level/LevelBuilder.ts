import * as THREE from 'three';
import { COLORS } from '../core/Constants';
import type { WorldSpec } from '../sim/types';
import { TRACK_HALF_WIDTH, trackEdges, type CenterlinePoint } from './MonzaTrack';

/** Plain rectangle spec for the rendered start/finish line (purely cosmetic). */
export type StartFinishLine = {
  center: [number, number]; // x, z
  width: number; // across the track (x)
  depth: number; // along the track (z)
  headingRad: number;
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
    private readonly centerline: CenterlinePoint[],
  ) {}

  build(): void {
    this.createGround();
    this.createRibbon();
    this.createEdgeLines();
    this.createGravel();
    this.createKerbs();
    this.createStartFinish();
    this.createBarriers();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  /** Large surrounding sunlit-grass plane so the world has a real horizon, not void. */
  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_FAR, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.06;
    mesh.receiveShadow = true;
    mesh.name = 'ground-plane';
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  /** The asphalt ribbon: one smooth triangle strip swept ±half-width along the centerline. */
  private createRibbon(): void {
    const { left, right } = trackEdges(this.centerline);
    const n = this.centerline.length;
    const positions = new Float32Array((n + 1) * 2 * 3);
    const uvs = new Float32Array((n + 1) * 2 * 2);
    const y = 0.01;
    let acc = 0;
    for (let i = 0; i <= n; i++) {
      const j = i % n;
      const l = left[j];
      const r = right[j];
      if (i > 0) {
        const pj = (i - 1) % n;
        acc += Math.hypot(this.centerline[j].pos[0] - this.centerline[pj].pos[0], this.centerline[j].pos[1] - this.centerline[pj].pos[1]);
      }
      const base = i * 2 * 3;
      positions[base + 0] = l[0]; positions[base + 1] = y; positions[base + 2] = l[1];
      positions[base + 3] = r[0]; positions[base + 4] = y; positions[base + 5] = r[1];
      const ub = i * 2 * 2;
      const v = acc / (TRACK_HALF_WIDTH * 2);
      uvs[ub + 0] = 0; uvs[ub + 1] = v;
      uvs[ub + 2] = 1; uvs[ub + 3] = v;
    }
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const texture = this.makeAsphaltTexture();
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.ASPHALT,
      roughness: 0.92,
      metalness: 0.04,
      map: texture,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'monza-ribbon';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  /** Thin white edge lines down both verges of the ribbon (track limits). */
  private createEdgeLines(): void {
    const { left, right } = trackEdges(this.centerline);
    const material = new THREE.LineBasicMaterial({ color: COLORS.PAINT });
    this.disposables.push(material);
    for (const edge of [left, right]) {
      const pts = edge.map(([x, z]) => new THREE.Vector3(x, 0.03, z));
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
    mesh.position.set(sf.center[0], 0.03, sf.center[1]);
    mesh.name = 'start-finish-line';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  private createBarriers(): void {
    const material = new THREE.MeshStandardMaterial({ color: COLORS.BARRIER, roughness: 0.7, metalness: 0.1 });
    this.disposables.push(material);
    // Barriers repeat in their hundreds around the ribbon — instance them so the
    // boundary costs a couple of draw calls, not one per wall (threejs-perf).
    const boxes = this.world.barriers;
    if (boxes.length === 0) return;
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
        m.compose(pos, q, one);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    }
  }

  /** Subtle procedural asphalt: faint mottled noise so the road isn't a flat slab. */
  private makeAsphaltTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#24262b';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
      const v = 20 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgba(${v},${v},${v + 2},${Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    texture.anisotropy = 4;
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
}
