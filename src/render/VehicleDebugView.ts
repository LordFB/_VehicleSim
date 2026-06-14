import * as THREE from 'three';
import { COLORS, DEBUG_VISUALS } from '../core/Constants';
import type { PhysicsSnapshot, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

type DebugWheel = {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  linePositions: Float32Array;
  patch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
};

export class VehicleDebugView {
  readonly group = new THREE.Group();
  private readonly wheels = new Map<WheelId, DebugWheel>();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor() {
    this.group.name = 'vehicle-debug-view';
    for (const id of WHEEL_IDS) {
      const linePositions = new Float32Array(6);
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      const lineMaterial = new THREE.LineBasicMaterial({ color: COLORS.FORCE_LONGITUDINAL });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.name = `debug-force-${id}`;

      const patchGeometry = new THREE.CircleGeometry(DEBUG_VISUALS.CONTACT_PATCH_RADIUS, 18);
      const patchMaterial = new THREE.MeshBasicMaterial({
        color: COLORS.TIRE_COLD,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const patch = new THREE.Mesh(patchGeometry, patchMaterial);
      patch.rotation.x = -Math.PI / 2;
      patch.name = `debug-contact-${id}`;

      this.group.add(line, patch);
      this.wheels.set(id, { line, linePositions, patch });
      this.disposables.push(lineGeometry, lineMaterial, patchGeometry, patchMaterial);
    }
  }

  applySnapshot(snapshot: PhysicsSnapshot): void {
    for (const id of WHEEL_IDS) {
      const debugWheel = this.wheels.get(id);
      const telemetry = snapshot.telemetry.wheels[id];
      if (!debugWheel || !telemetry) continue;

      const contact = telemetry.contact;
      debugWheel.line.visible = contact;
      debugWheel.patch.visible = contact;
      if (!contact) continue;

      const start = new THREE.Vector3(telemetry.contactPoint[0], telemetry.contactPoint[1] + 0.05, telemetry.contactPoint[2]);
      const force = new THREE.Vector3(telemetry.forceWorld[0], telemetry.forceWorld[1], telemetry.forceWorld[2]);
      const length = Math.min(DEBUG_VISUALS.FORCE_VECTOR_MAX_LENGTH, force.length() * DEBUG_VISUALS.FORCE_VECTOR_SCALE);
      const end = force.lengthSq() > 1 ? start.clone().add(force.normalize().multiplyScalar(length)) : start.clone();

      debugWheel.linePositions[0] = start.x;
      debugWheel.linePositions[1] = start.y;
      debugWheel.linePositions[2] = start.z;
      debugWheel.linePositions[3] = end.x;
      debugWheel.linePositions[4] = end.y;
      debugWheel.linePositions[5] = end.z;
      debugWheel.line.geometry.attributes.position.needsUpdate = true;
      debugWheel.line.material.color.setHex(forceColor(telemetry.slipRatio, telemetry.slipAngleRad));

      const loadScale = 1 + Math.min(0.45, telemetry.loadN * DEBUG_VISUALS.CONTACT_PATCH_LOAD_SCALE);
      debugWheel.patch.position.set(telemetry.contactPoint[0], telemetry.contactPoint[1] + 0.022, telemetry.contactPoint[2]);
      debugWheel.patch.scale.set(loadScale, loadScale, loadScale);
      debugWheel.patch.material.color.setHex(temperatureColor(telemetry.tireSurfaceTempC, telemetry.tireMuScale));
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}

function forceColor(slipRatio: number, slipAngleRad: number): number {
  const combinedSlip = Math.abs(slipRatio) + Math.abs(slipAngleRad) * 1.8;
  return combinedSlip > 0.8 ? COLORS.TIRE_HOT : combinedSlip > 0.35 ? COLORS.FORCE_LATERAL : COLORS.FORCE_LONGITUDINAL;
}

function temperatureColor(surfaceTempC: number, muScale: number): number {
  if (surfaceTempC < 65) return COLORS.TIRE_COLD;
  if (surfaceTempC > 118 || muScale < 0.82) return COLORS.TIRE_HOT;
  return COLORS.TIRE_READY;
}
