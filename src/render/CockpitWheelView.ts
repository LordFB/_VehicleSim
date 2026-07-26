import * as THREE from 'three';
import { CAMERA, COCKPIT, COLORS } from '../core/Constants';
import type { PhysicsSnapshot } from '../sim/types';
import type { CameraMode } from './RaceCamera';

export class CockpitWheelView {
  readonly group = new THREE.Group();
  readonly steeringWheel = new THREE.Group();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly ledMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(environment: THREE.Texture | null = null) {
    this.group.name = 'cockpit-wheel-view';
    this.group.visible = false;

    const carbon = this.mat(0x30343a, 0.55, 0.55, environment, 0.7);
    const satin = this.mat(0x56606a, 0.7, 0.25, environment, 0.5);
    const rubber = this.mat(COLORS.WHEEL, 0.88, 0.02, null, 0);
    const display = this.mat(COLORS.CAR_GLASS, 0.32, 0.12, null, 0);
    display.emissive.setHex(0x0b4e68);
    display.emissiveIntensity = 0.6;
    const cyan = this.mat(COLORS.FORCE_LONGITUDINAL, 0.35, 0.1, null, 0);
    const amber = this.mat(COLORS.CAR_ACCENT_2, 0.35, 0.1, null, 0);
    const red = this.mat(COLORS.CAR_BODY_ACCENT, 0.35, 0.1, null, 0);

    this.buildCockpitShell(carbon, satin);
    this.buildWheel(carbon, rubber, display, cyan, amber, red);
  }

  setCameraMode(mode: CameraMode): void {
    this.group.visible = mode === 'onboard';
  }

  applySnapshot(snapshot: PhysicsSnapshot): void {
    this.group.position.set(
      snapshot.chassis.position[0],
      snapshot.chassis.position[1],
      snapshot.chassis.position[2],
    );
    this.group.quaternion.set(
      snapshot.chassis.orientation[0],
      snapshot.chassis.orientation[1],
      snapshot.chassis.orientation[2],
      snapshot.chassis.orientation[3],
    );
    this.steeringWheel.rotation.set(
      COCKPIT.WHEEL_TILT_RAD,
      0,
      -snapshot.telemetry.steeringAngleRad * COCKPIT.WHEEL_STEER_RATIO,
    );
    this.updateShiftLeds(snapshot.telemetry.rpm);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private buildCockpitShell(carbon: THREE.Material, satin: THREE.Material): void {
    const coaming = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 10, 28), carbon);
    coaming.name = 'cockpit-coaming';
    coaming.position.set(0, 0.16, 0.49);
    coaming.rotation.x = Math.PI / 2;
    coaming.scale.set(1.18, 0.62, 1);
    this.group.add(coaming);
    this.disposables.push(coaming.geometry);

    this.box(carbon, 0.58, 0.08, 0.92, 0, 0.02, 0.76);
    // Slim halo members at realistic eye clearance. The former pillar was both
    // too wide and too close, obscuring the braking point in onboard view.
    this.box(satin, 0.045, 0.46, 0.04, 0, 0.29, 1.18);
    this.box(satin, 0.035, 0.035, 0.78, -0.34, 0.43, 0.82);
    this.box(satin, 0.035, 0.035, 0.78, 0.34, 0.43, 0.82);
  }

  private buildWheel(
    carbon: THREE.Material,
    rubber: THREE.Material,
    display: THREE.Material,
    cyan: THREE.Material,
    amber: THREE.Material,
    red: THREE.Material,
  ): void {
    this.steeringWheel.name = 'cockpit-steering-wheel';
    this.steeringWheel.position.set(
      CAMERA.ONBOARD.WHEEL_OFFSET[0],
      CAMERA.ONBOARD.WHEEL_OFFSET[1],
      CAMERA.ONBOARD.WHEEL_OFFSET[2],
    );
    this.steeringWheel.scale.setScalar(0.7);
    this.group.add(this.steeringWheel);

    const top = this.wheelBox(carbon, 0.42, 0.045, 0.035, 0, 0.11, 0);
    top.name = 'cockpit-steering-wheel-rim';
    this.wheelBox(carbon, 0.4, 0.045, 0.035, 0, -0.11, 0);
    this.wheelBox(rubber, 0.07, 0.23, 0.045, -0.25, 0, 0);
    this.wheelBox(rubber, 0.07, 0.23, 0.045, 0.25, 0, 0);
    this.wheelBox(carbon, 0.18, 0.16, 0.035, 0, 0, 0.005);
    this.wheelBox(display, 0.14, 0.06, 0.04, 0, 0.0, 0.035);

    for (let i = 0; i < COCKPIT.SHIFT_LED_COUNT; i += 1) {
      const material = this.mat(0x10202a, 0.35, 0.05, null, 0);
      const led = this.wheelBox(material, 0.026, 0.014, 0.012, -0.104 + i * 0.026, 0.055, 0.052);
      led.name = `cockpit-shift-led-${i}`;
      this.ledMaterials.push(material);
    }

    this.rotary(cyan, -0.09, -0.055);
    this.rotary(amber, 0.09, -0.055);
    this.rotary(red, 0, -0.078);
  }

  private updateShiftLeds(rpm: number): void {
    const rpmFrac = Math.max(0, Math.min(1, rpm / 8600));
    const active = Math.round(Math.max(0, rpmFrac - COCKPIT.LED_RPM_START_FRAC) / (1 - COCKPIT.LED_RPM_START_FRAC) * COCKPIT.SHIFT_LED_COUNT);
    for (let i = 0; i < this.ledMaterials.length; i += 1) {
      const material = this.ledMaterials[i];
      const on = i < active;
      material.color.setHex(on ? (i > 6 ? COLORS.CAR_BODY_ACCENT : i > 3 ? COLORS.CAR_ACCENT_2 : COLORS.FORCE_LONGITUDINAL) : 0x10202a);
      material.emissive.setHex(on ? material.color.getHex() : 0x000000);
      material.emissiveIntensity = on ? 0.55 : 0;
    }
  }

  private box(material: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    this.group.add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  private wheelBox(material: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    this.steeringWheel.add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  private rotary(material: THREE.Material, x: number, y: number): void {
    const geometry = new THREE.CylinderGeometry(0.028, 0.028, 0.018, 14);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0.055);
    mesh.rotation.x = Math.PI / 2;
    this.steeringWheel.add(mesh);
    this.disposables.push(geometry);
  }

  private mat(color: number, roughness: number, metalness: number, env: THREE.Texture | null, envIntensity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: env, envMapIntensity: envIntensity });
    this.disposables.push(m);
    return m;
  }
}
