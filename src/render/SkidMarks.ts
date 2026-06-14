import * as THREE from 'three';
import { COLORS, JUICE } from '../core/Constants';
import type { PhysicsSnapshot, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * Pooled skid marks: a fixed ring buffer of dark quads laid flat on the ground at
 * each slipping wheel's contact point. When a tire's slip exceeds threshold we drop
 * a segment (spaced so we don't flood), connecting it to the previous point for that
 * wheel so the marks read as continuous streaks. Capped length keeps it cheap.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly maxQuads = JUICE.SKID_MAX_QUADS;
  private head = 0;
  private count = 0;
  private readonly lastDrop = new Map<WheelId, THREE.Vector3>();

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    // 6 vertices (2 triangles) per quad, 3 floats each.
    this.positions = new Float32Array(this.maxQuads * 6 * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      color: COLORS.SKID,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'skid-marks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  update(snapshot: PhysicsSnapshot): void {
    for (const id of WHEEL_IDS) {
      const w = snapshot.telemetry.wheels[id];
      if (!w.contact) {
        this.lastDrop.delete(id);
        continue;
      }
      const slipping = Math.abs(w.slipRatio) > JUICE.SKID_SLIP_RATIO || Math.abs(w.slipAngleRad) > JUICE.SKID_SLIP_ANGLE_RAD;
      if (!slipping) {
        this.lastDrop.delete(id);
        continue;
      }
      const here = new THREE.Vector3(w.contactPoint[0], w.contactPoint[1] + 0.02, w.contactPoint[2]);
      const prev = this.lastDrop.get(id);
      if (prev && prev.distanceTo(here) < JUICE.SKID_MIN_STEP) continue;
      if (prev) this.addSegment(prev, here);
      this.lastDrop.set(id, here.clone());
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.lastDrop.clear();
    this.geometry.setDrawRange(0, 0);
  }

  /** Add a flat quad spanning prev->here, width SKID_WIDTH, into the ring buffer. */
  private addSegment(prev: THREE.Vector3, here: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(here, prev);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    // Perpendicular on the ground plane.
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(JUICE.SKID_WIDTH * 0.5);

    const a = new THREE.Vector3().subVectors(prev, side);
    const b = new THREE.Vector3().addVectors(prev, side);
    const c = new THREE.Vector3().subVectors(here, side);
    const d = new THREE.Vector3().addVectors(here, side);

    const base = this.head * 6 * 3;
    this.writeTri(base, a, b, c);
    this.writeTri(base + 9, b, d, c);

    this.head = (this.head + 1) % this.maxQuads;
    this.count = Math.min(this.count + 1, this.maxQuads);
    this.geometry.setDrawRange(0, this.count * 6);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private writeTri(offset: number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): void {
    const a = this.positions;
    a[offset] = p0.x; a[offset + 1] = p0.y; a[offset + 2] = p0.z;
    a[offset + 3] = p1.x; a[offset + 4] = p1.y; a[offset + 5] = p1.z;
    a[offset + 6] = p2.x; a[offset + 7] = p2.y; a[offset + 8] = p2.z;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
