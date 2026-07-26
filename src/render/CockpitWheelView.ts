import * as THREE from 'three';
import { CAMERA, COCKPIT, COLORS } from '../core/Constants';
import type { PhysicsSnapshot } from '../sim/types';
import type { CameraMode } from './RaceCamera';

export class CockpitWheelView {
  readonly group = new THREE.Group();
  readonly steeringWheel = new THREE.Group();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly ledMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly frontWheels: THREE.Group[] = [];

  constructor(environment: THREE.Texture | null = null) {
    this.group.name = 'cockpit-wheel-view';
    this.group.visible = false;

    const carbon = this.mat(0x15191f, 0.48, 0.5, environment, 0.8);
    const satin = this.mat(0x4a535d, 0.62, 0.35, environment, 0.65);
    const body = this.mat(COLORS.CAR_BODY_ACCENT, 0.32, 0.24, environment, 0.8);
    const livery = this.mat(COLORS.CAR_ACCENT_2, 0.38, 0.28, environment, 0.7);
    const rubber = this.mat(COLORS.WHEEL, 0.88, 0.02, null, 0);
    const rim = this.mat(COLORS.CAR_RIM, 0.28, 0.82, environment, 0.9);
    const mirror = this.mat(0x7aa7bd, 0.12, 0.65, environment, 1.25);
    const display = this.mat(COLORS.CAR_GLASS, 0.32, 0.12, null, 0);
    display.emissive.setHex(0x0b4e68);
    display.emissiveIntensity = 0.6;
    const cyan = this.mat(COLORS.FORCE_LONGITUDINAL, 0.35, 0.1, null, 0);
    const amber = this.mat(COLORS.CAR_ACCENT_2, 0.35, 0.1, null, 0);
    const red = this.mat(COLORS.CAR_BODY_ACCENT, 0.35, 0.1, null, 0);

    this.buildCockpitShell(carbon, satin, body, livery, rubber, rim, mirror, display);
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
    for (const wheel of this.frontWheels) {
      wheel.rotation.y = snapshot.telemetry.steeringAngleRad;
    }
    this.updateShiftLeds(snapshot.telemetry.rpm);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private buildCockpitShell(
    carbon: THREE.Material,
    satin: THREE.Material,
    body: THREE.Material,
    livery: THREE.Material,
    rubber: THREE.Material,
    rim: THREE.Material,
    mirror: THREE.Material,
    display: THREE.Material,
  ): void {
    const coaming = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 10, 28), carbon);
    coaming.name = 'cockpit-coaming';
    coaming.position.set(0, 0.16, 0.49);
    coaming.rotation.x = Math.PI / 2;
    coaming.scale.set(1.18, 0.62, 1);
    this.group.add(coaming);
    this.disposables.push(coaming.geometry);

    // Deep monocoque shoulders frame the driver without blocking the braking point.
    for (const side of [-1, 1]) {
      const shoulder = this.box(body, 0.24, 0.18, 1.18, side * 0.34, 0.01, 0.72);
      shoulder.rotation.z = side * -0.08;
      this.box(livery, 0.045, 0.025, 0.94, side * 0.31, 0.115, 0.8);
    }

    // Long tapered nose and center stripe: these dominate the lower center of the
    // onboard frame and give accurate front-axle placement cues.
    const noseGeometry = new THREE.ConeGeometry(0.25, 1.95, 5, 1);
    const nose = new THREE.Mesh(noseGeometry, body);
    nose.name = 'cockpit-nose';
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.scale.set(0.7, 1, 0.55);
    nose.position.set(0, -0.09, 1.48);
    this.group.add(nose);
    this.disposables.push(noseGeometry);
    this.box(livery, 0.055, 0.025, 1.42, 0, 0.06, 1.4);
    this.box(carbon, 1.62, 0.025, 0.25, 0, -0.27, 2.36);

    this.buildFrontCorner(-1, carbon, satin, rubber, rim);
    this.buildFrontCorner(1, carbon, satin, rubber, rim);
    this.buildMirror(-1, carbon, body, mirror);
    this.buildMirror(1, carbon, body, mirror);

    const dashboard = new THREE.Group();
    dashboard.name = 'cockpit-dashboard';
    dashboard.add(this.localBox(carbon, 0.42, 0.12, 0.08, 0, 0, 0));
    dashboard.add(this.localBox(display, 0.28, 0.065, 0.012, 0, 0.005, -0.048));
    dashboard.position.set(0, 0.17, 0.77);
    this.group.add(dashboard);
  }

  private buildFrontCorner(
    side: -1 | 1,
    carbon: THREE.Material,
    suspension: THREE.Material,
    rubber: THREE.Material,
    rim: THREE.Material,
  ): void {
    const sideName = side < 0 ? 'left' : 'right';
    const wheel = new THREE.Group();
    wheel.name = `cockpit-front-${sideName}-wheel`;
    wheel.position.set(side * 0.76, -0.28, 1.6);
    const tireGeometry = new THREE.CylinderGeometry(0.29, 0.29, 0.215, 24);
    const tire = new THREE.Mesh(tireGeometry, rubber);
    tire.rotation.z = Math.PI / 2;
    wheel.add(tire);
    const rimGeometry = new THREE.CylinderGeometry(0.145, 0.145, 0.225, 18);
    const wheelRim = new THREE.Mesh(rimGeometry, rim);
    wheelRim.rotation.z = Math.PI / 2;
    wheel.add(wheelRim);
    this.group.add(wheel);
    this.frontWheels.push(wheel);
    this.disposables.push(tireGeometry, rimGeometry);

    const links = new THREE.Group();
    links.name = `cockpit-front-${sideName}-suspension`;
    const upright = new THREE.Vector3(side * 0.69, -0.21, 1.58);
    for (const anchor of [
      new THREE.Vector3(side * 0.22, -0.22, 1.26),
      new THREE.Vector3(side * 0.25, 0.01, 1.22),
      new THREE.Vector3(side * 0.18, 0.08, 1.48),
    ]) {
      links.add(this.linkBetween(anchor, upright, suspension, 0.014));
    }
    const brakeDuct = this.localBox(carbon, 0.09, 0.15, 0.13, side * 0.64, -0.22, 1.58);
    links.add(brakeDuct);
    this.group.add(links);
  }

  private buildMirror(
    side: -1 | 1,
    carbon: THREE.Material,
    body: THREE.Material,
    mirror: THREE.Material,
  ): void {
    const sideName = side < 0 ? 'left' : 'right';
    const assembly = new THREE.Group();
    assembly.name = `cockpit-${sideName}-mirror`;
    assembly.position.set(side * 0.49, 0.28, 0.72);
    const stalk = this.linkBetween(
      new THREE.Vector3(0, -0.16, 0.08),
      new THREE.Vector3(side * 0.12, 0, 0),
      carbon,
      0.012,
    );
    assembly.add(stalk);
    const housing = this.localBox(body, 0.22, 0.09, 0.12, side * 0.14, 0.02, 0);
    housing.rotation.y = side * -0.16;
    assembly.add(housing);
    const glass = this.localBox(mirror, 0.17, 0.06, 0.008, side * 0.14, 0.02, -0.064);
    glass.rotation.y = side * -0.16;
    assembly.add(glass);
    this.group.add(assembly);
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
    this.wheelBox(carbon, 0.055, 0.12, 0.028, -0.15, -0.005, 0.012);
    this.wheelBox(carbon, 0.055, 0.12, 0.028, 0.15, -0.005, 0.012);

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

  private localBox(material: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    this.disposables.push(geometry);
    return mesh;
  }

  private linkBetween(
    start: THREE.Vector3,
    end: THREE.Vector3,
    material: THREE.Material,
    radius: number,
  ): THREE.Mesh {
    const direction = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 8);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
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
