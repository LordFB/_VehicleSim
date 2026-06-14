import * as THREE from 'three';
import { JUICE } from '../core/Constants';
import type { PhysicsSnapshot, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * Pooled tire smoke: additive soft puffs emitted from contact points when combined
 * slip is high, drifting upward and fading over their lifetime. A fixed pool of
 * THREE.Points is recycled — no per-frame allocation, capped particle count.
 */
export class TireSmoke {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array; // remaining seconds, 0 = dead
  private readonly max = JUICE.SMOKE_MAX;
  private cursor = 0;

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    // Park dead particles far below the world so they aren't visible.
    for (let i = 0; i < this.max; i++) this.positions[i * 3 + 1] = -1000;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      size: 1.7,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: 0xd6d6da,
      map: this.makeSprite(),
      opacity: 0.5,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.name = 'tire-smoke';
    this.points.frustumCulled = false;
  }

  update(snapshot: PhysicsSnapshot, dt: number): void {
    // Age existing particles. Dead ones teleport below world (cheap cull, no shader).
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }

    // Emit from slipping wheels.
    for (const id of WHEEL_IDS) {
      const w = snapshot.telemetry.wheels[id];
      if (!w.contact) continue;
      const combined = Math.hypot(w.slipRatio, w.slipAngleRad);
      if (combined < JUICE.SMOKE_SLIP) continue;
      const rate = Math.min(3, Math.floor((combined - JUICE.SMOKE_SLIP) * 4) + 1);
      for (let n = 0; n < rate; n++) this.spawn(w.contactPoint);
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawn(contact: [number, number, number]): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.positions[i * 3] = contact[0] + (Math.random() - 0.5) * 0.3;
    this.positions[i * 3 + 1] = contact[1] + 0.1;
    this.positions[i * 3 + 2] = contact[2] + (Math.random() - 0.5) * 0.3;
    this.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
    this.velocities[i * 3 + 1] = JUICE.SMOKE_RISE * (0.6 + Math.random() * 0.6);
    this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    this.life[i] = JUICE.SMOKE_LIFE * (0.7 + Math.random() * 0.5);
  }

  private makeSprite(): THREE.Texture {
    const s = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(220,220,225,0.9)');
    g.addColorStop(0.5, 'rgba(200,200,205,0.4)');
    g.addColorStop(1, 'rgba(200,200,205,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  }

  dispose(): void {
    this.geometry.dispose();
    const mat = this.points.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}
