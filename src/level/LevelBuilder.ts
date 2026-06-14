import * as THREE from 'three';
import { COLORS } from '../core/Constants';
import type { WorldSpec } from '../sim/types';

/** Plain rectangle spec for the rendered start/finish line (purely cosmetic). */
export type StartFinishLine = {
  center: [number, number]; // x, z
  width: number; // across the track (x)
  depth: number; // along the track (z)
  headingRad: number;
};

export class LevelBuilder {
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: WorldSpec,
    private readonly startFinish?: StartFinishLine,
  ) {}

  build(): void {
    this.createGround();
    this.createRoad();
    this.createZones();
    this.createStartFinish();
    this.createBarriers();
    this.createReferenceMarkers();
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  /** Large surrounding sunlit-grass plane so the world has a real horizon, not void. */
  private createGround(): void {
    const geometry = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: COLORS.GRASS_FAR, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.04;
    mesh.receiveShadow = true;
    mesh.name = 'ground-plane';
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  /** The asphalt ribbon, rendered as a textured PBR road that receives shadows. */
  private createRoad(): void {
    const texture = this.makeAsphaltTexture();
    const geometry = new THREE.PlaneGeometry(64, 150, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.ASPHALT,
      roughness: 0.92,
      metalness: 0.04,
      map: texture,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.z = 12;
    mesh.position.y = 0.0;
    mesh.receiveShadow = true;
    mesh.name = 'asphalt-test-plane';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  private createZones(): void {
    for (const zone of this.world.zones) {
      // Kerbs get the iconic alternating red/white rumble-strip treatment.
      if (zone.materialId === 'kerb' && zone.type === 'rect' && zone.size) {
        this.createKerb(zone.id, zone.center, zone.size, zone.heightOffset ?? 0);
        continue;
      }
      const material = new THREE.MeshStandardMaterial({
        color: colorForMaterial(zone.materialId),
        roughness: roughnessForMaterial(zone.materialId),
        metalness: 0,
        transparent: zone.materialId === 'painted_line',
        opacity: zone.materialId === 'painted_line' ? 0.96 : 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      let mesh: THREE.Mesh;
      if (zone.type === 'ring' && zone.radius && zone.innerRadius) {
        const geometry = new THREE.RingGeometry(zone.innerRadius, zone.radius, 96);
        mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        this.disposables.push(geometry, material);
      } else if (zone.type === 'circle' && zone.radius) {
        const geometry = new THREE.CircleGeometry(zone.radius, 64);
        mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        this.disposables.push(geometry, material);
      } else {
        const size = zone.size ?? [1, 1];
        const geometry = new THREE.PlaneGeometry(size[0], size[1]);
        mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        this.disposables.push(geometry, material);
      }
      mesh.position.set(zone.center[0], (zone.heightOffset ?? 0) + 0.015, zone.center[1]);
      mesh.receiveShadow = zone.materialId === 'grass' || zone.materialId === 'gravel';
      mesh.name = `surface-zone-${zone.id}`;
      this.scene.add(mesh);
    }
  }

  /** Alternating red/white segments along a rectangular kerb zone. */
  private createKerb(id: string, center: [number, number], size: [number, number], heightOffset: number): void {
    const group = new THREE.Group();
    group.name = `kerb-${id}`;
    const along = Math.max(size[0], size[1]);
    const across = Math.min(size[0], size[1]);
    const alongIsZ = size[1] >= size[0];
    const segLen = 1.0;
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
    if (!this.startFinish) return;
    const sf = this.startFinish;
    // Checkered start/finish bar.
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
    mesh.position.set(sf.center[0], 0.02, sf.center[1]);
    mesh.name = 'start-finish-line';
    this.scene.add(mesh);
    this.disposables.push(geometry, material, texture);
  }

  private createBarriers(): void {
    const material = new THREE.MeshStandardMaterial({ color: COLORS.BARRIER, roughness: 0.7, metalness: 0.1 });
    this.disposables.push(material);
    for (const barrier of this.world.barriers) {
      const geometry = new THREE.BoxGeometry(barrier.halfExtents[0] * 2, barrier.halfExtents[1] * 2, barrier.halfExtents[2] * 2);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...barrier.center);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `barrier-${barrier.id}`;
      this.scene.add(mesh);
      this.disposables.push(geometry);
    }
  }

  private createReferenceMarkers(): void {
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf7d154 });
    const geometry = new THREE.TorusGeometry(12, 0.05, 8, 96);
    const skidpad = new THREE.Mesh(geometry, markerMaterial);
    skidpad.rotation.x = Math.PI / 2;
    skidpad.position.set(-22, 0.04, 18);
    skidpad.name = 'skidpad-radius-marker';
    this.scene.add(skidpad);
    this.disposables.push(geometry, markerMaterial);
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
    texture.repeat.set(8, 18);
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

function colorForMaterial(materialId: string): number {
  if (materialId === 'painted_line') return COLORS.PAINT;
  if (materialId === 'kerb') return COLORS.KERB_RED;
  if (materialId === 'grass') return COLORS.GRASS;
  if (materialId === 'gravel') return COLORS.GRAVEL;
  if (materialId === 'ice') return COLORS.ICE;
  return COLORS.ASPHALT;
}

function roughnessForMaterial(materialId: string): number {
  if (materialId === 'ice') return 0.12;
  if (materialId === 'painted_line') return 0.5;
  if (materialId === 'gravel') return 0.98;
  return 0.95;
}
