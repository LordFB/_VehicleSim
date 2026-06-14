import * as THREE from 'three';
import { COLORS } from '../core/Constants';
import type { PhysicsSnapshot, VehicleSpec, WheelId } from '../sim/types';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

export class VehicleView {
  readonly group = new THREE.Group();
  private readonly chassis: THREE.Group;
  private readonly wheels = new Map<WheelId, THREE.Group>();
  private readonly wheelMaterials = new Map<WheelId, THREE.MeshStandardMaterial>();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  constructor(spec: VehicleSpec, environment: THREE.Texture | null = null) {
    this.group.name = 'vehicle-view';
    const [w, h, l] = spec.chassis.dimensions;

    // Composed body silhouette (cosmetic children, all within the physics extents).
    this.chassis = new THREE.Group();
    this.chassis.name = 'vehicle-chassis';
    this.group.add(this.chassis);

    const paint = new THREE.MeshStandardMaterial({
      color: COLORS.CAR_BODY,
      roughness: 0.22,
      metalness: 0.55,
      envMap: environment,
      envMapIntensity: 1.1,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: COLORS.CAR_BODY_ACCENT,
      roughness: 0.3,
      metalness: 0.5,
      envMap: environment,
      envMapIntensity: 0.9,
    });
    this.disposables.push(paint, accent);

    // Low, wide main hull running most of the length (the sleek base).
    this.addBox(this.chassis, paint, w * 0.99, h * 0.4, l * 0.99, 0, -h * 0.2, 0);
    // Subtle shoulder line, narrower and short, kept low for a sloped read.
    this.addBox(this.chassis, paint, w * 0.86, h * 0.2, l * 0.5, 0, h * 0.02, -l * 0.04);
    // Long low hood (front) and a short raised rear deck/wing base.
    this.addBox(this.chassis, accent, w * 0.9, h * 0.12, l * 0.34, 0, -h * 0.04, l * 0.3);
    this.addBox(this.chassis, accent, w * 0.92, h * 0.14, l * 0.16, 0, h * 0.02, -l * 0.42);
    // Splitter lip up front.
    this.addBox(this.chassis, accent, w * 0.96, h * 0.05, l * 0.08, 0, -h * 0.22, l * 0.47);

    // Greenhouse / cabin glass — low, narrow, set back (sleek cockpit, not a box).
    const glass = new THREE.MeshStandardMaterial({
      color: COLORS.CAR_GLASS,
      roughness: 0.1,
      metalness: 0.2,
      envMap: environment,
      envMapIntensity: 1.6,
    });
    this.disposables.push(glass);
    this.addBox(this.chassis, glass, w * 0.56, h * 0.2, l * 0.3, 0, h * 0.14, -l * 0.08);

    for (const part of this.chassis.children) {
      (part as THREE.Mesh).castShadow = true;
      (part as THREE.Mesh).receiveShadow = true;
    }

    // Wheels: tire + rim + disc, grouped so we keep the physics-driven pose.
    const tireMatProto = new THREE.MeshStandardMaterial({ color: COLORS.WHEEL, roughness: 0.92, metalness: 0.05 });
    const rimMat = new THREE.MeshStandardMaterial({ color: COLORS.CAR_RIM, roughness: 0.35, metalness: 0.8, envMap: environment, envMapIntensity: 1.0 });
    const discMat = new THREE.MeshStandardMaterial({ color: COLORS.CAR_DISC, roughness: 0.5, metalness: 0.7 });
    this.disposables.push(rimMat, discMat);

    for (const wheelSpec of spec.wheels) {
      const wheelGroup = new THREE.Group();
      wheelGroup.name = `wheel-${wheelSpec.id}`;
      const r = wheelSpec.tire.radius;
      const width = wheelSpec.tire.width;

      const tireMaterial = tireMatProto.clone();
      const tireGeo = new THREE.CylinderGeometry(r, r, width, 28);
      const tire = new THREE.Mesh(tireGeo, tireMaterial);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wheelGroup.add(tire);
      this.disposables.push(tireGeo, tireMaterial);

      const discGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 0.6, 20);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.z = Math.PI / 2;
      wheelGroup.add(disc);
      this.disposables.push(discGeo);

      const rimGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.55, width * 1.02, 10);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.rotation.z = Math.PI / 2;
      wheelGroup.add(rim);
      this.disposables.push(rimGeo);

      this.group.add(wheelGroup);
      this.wheels.set(wheelSpec.id, wheelGroup);
      this.wheelMaterials.set(wheelSpec.id, tireMaterial);
    }
  }

  private addBox(
    parent: THREE.Object3D,
    material: THREE.Material,
    sx: number, sy: number, sz: number,
    px: number, py: number, pz: number,
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    parent.add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  applySnapshot(snapshot: PhysicsSnapshot): void {
    setPose(this.chassis, snapshot.chassis.position, snapshot.chassis.orientation);
    for (const id of WHEEL_IDS) {
      const wheel = this.wheels.get(id);
      const wheelSnapshot = snapshot.wheels[id];
      if (!wheel || !wheelSnapshot) continue;
      setPose(wheel, wheelSnapshot.pose.position, wheelSnapshot.pose.orientation);
      const telemetry = snapshot.telemetry.wheels[id];
      const material = this.wheelMaterials.get(id);
      if (material && telemetry) {
        material.color.setHex(temperatureColor(telemetry.tireSurfaceTempC, telemetry.tireMuScale));
        material.emissive.setHex(telemetry.brakeTempC > 500 ? 0x441000 : 0x000000);
        material.emissiveIntensity = telemetry.brakeTempC > 500 ? Math.min(0.5, (telemetry.brakeTempC - 500) / 500) : 0;
      }
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}

function setPose(object: THREE.Object3D, position: [number, number, number], orientation: [number, number, number, number]): void {
  object.position.set(position[0], position[1], position[2]);
  object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
}

function temperatureColor(surfaceTempC: number, muScale: number): number {
  if (surfaceTempC < 65) return COLORS.TIRE_COLD;
  if (surfaceTempC > 118 || muScale < 0.82) return COLORS.TIRE_HOT;
  return COLORS.TIRE_READY;
}
