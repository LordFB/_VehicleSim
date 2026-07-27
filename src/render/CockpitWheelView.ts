import * as THREE from 'three';
import { CAMERA, COCKPIT, COLORS } from '../core/Constants';
import type { PhysicsSnapshot } from '../sim/types';
import type { CameraMode } from './RaceCamera';
import { aerofoil, loftBody, rimBarrel, spoke, tyre } from './VehicleBodywork';

export class CockpitWheelView {
  readonly group = new THREE.Group();
  /**
   * Mount for the steering wheel: carries the fixed column tilt only. The rim
   * spins inside it (see `wheelRim`) so steering rotates the wheel about its own
   * axis. Applying tilt and spin as Euler angles on one node made the Z-spin
   * resolve before the X-tilt, which swung the wheel's face away from the driver.
   */
  readonly steeringWheel = new THREE.Group();
  /** Rim + hub + controls, spun by steering input about the column axis. */
  private readonly wheelRim = new THREE.Group();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture> = [];
  private readonly ledMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly frontWheels: THREE.Group[] = [];
  /** Offscreen canvas backing the wheel's dash screen (speed + gear). */
  private readonly dashCanvas = createDashCanvas();
  private dashTexture: THREE.CanvasTexture | null = null;
  /** Last values drawn, so the texture only re-uploads when something changes. */
  private lastDash = { kmh: -1, gear: -999 };

  /** Rim rotation about the column axis, in radians (negative = steering right). */
  get steeringRotationRad(): number {
    return this.wheelRim.rotation.z;
  }

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
    // Spin the rim about the tilted column's own axis. The mount keeps the fixed
    // rake, so the wheel face stays square to the driver at every steering angle.
    this.wheelRim.rotation.z = -snapshot.telemetry.steeringAngleRad * COCKPIT.WHEEL_STEER_RATIO;
    for (const wheel of this.frontWheels) {
      wheel.rotation.y = snapshot.telemetry.steeringAngleRad;
    }
    this.updateShiftLeds(snapshot.telemetry.rpm);
    this.updateDash(snapshot.telemetry.speedMps, snapshot.telemetry.gear);
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
    const coaming = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.038, 16, 40), carbon);
    coaming.name = 'cockpit-coaming';
    coaming.position.set(0, 0.16, 0.49);
    coaming.rotation.x = Math.PI / 2;
    coaming.scale.set(1.18, 0.62, 1);
    this.group.add(coaming);
    this.disposables.push(coaming.geometry);

    // Monocoque shoulders, lofted so the flanks curve away from the driver's eye
    // instead of presenting the flat slab edge the box version showed.
    for (const side of [-1, 1]) {
      const shoulder = this.addGeo(
        loftBody(
          [
            { z: 0.13, halfWidth: 0.13, y: 0, top: 0.1, bottom: 0.11, squareness: 3.0 },
            { z: 0.6, halfWidth: 0.14, y: 0.02, top: 0.11, bottom: 0.12, squareness: 3.4 },
            { z: 1.0, halfWidth: 0.125, y: 0.01, top: 0.1, bottom: 0.12, squareness: 3.2 },
            { z: 1.31, halfWidth: 0.09, y: -0.02, top: 0.075, bottom: 0.1, squareness: 2.8 },
          ],
          20,
        ),
        body,
      );
      shoulder.position.set(side * 0.34, 0.01, 0);
      shoulder.rotation.z = side * -0.08;
      // Livery flash along the shoulder crest.
      this.box(livery, 0.045, 0.025, 0.94, side * 0.31, 0.115, 0.8);
    }

    // Long tapered nose: the dominant shape in the lower centre of the frame and
    // the driver's cue for front-axle placement. Lofted with a rounded crown so
    // it catches a highlight down the centreline.
    const nose = this.addGeo(
      loftBody(
        [
          { z: 0.5, halfWidth: 0.19, y: -0.1, top: 0.11, bottom: 0.13, squareness: 3.0 },
          { z: 1.05, halfWidth: 0.175, y: -0.11, top: 0.1, bottom: 0.12, squareness: 2.8 },
          { z: 1.6, halfWidth: 0.15, y: -0.13, top: 0.085, bottom: 0.11, squareness: 2.6 },
          { z: 2.05, halfWidth: 0.11, y: -0.16, top: 0.065, bottom: 0.085, squareness: 2.3 },
          { z: 2.4, halfWidth: 0.06, y: -0.2, top: 0.042, bottom: 0.05, squareness: 2.0 },
        ],
        24,
      ),
      body,
    );
    nose.name = 'cockpit-nose';
    this.box(livery, 0.055, 0.025, 1.42, 0, 0.06, 1.4);

    // Front wing seen from the cockpit: a real aerofoil section rather than a
    // flat plate, with the outer tips just inside the front tyres.
    const frontWing = this.addGeo(
      aerofoil({ span: 1.6, chord: 0.3, thickness: 0.028, camber: 0.022 }),
      carbon,
    );
    frontWing.position.set(0, -0.28, 2.34);

    this.buildFrontCorner(-1, carbon, satin, rubber, rim);
    this.buildFrontCorner(1, carbon, satin, rubber, rim);
    this.buildMirror(-1, carbon, body, mirror);
    this.buildMirror(1, carbon, body, mirror);

    const dashboard = new THREE.Group();
    dashboard.name = 'cockpit-dashboard';
    dashboard.add(this.localBox(carbon, 0.42, 0.12, 0.08, 0, 0, 0));
    dashboard.add(this.localBox(display, 0.28, 0.065, 0.012, 0, 0.005, -0.048));
    dashboard.position.set(0, 0.2, 0.84);
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
    // Lathed slick with rounded shoulders, matching the external car's tyres —
    // these fill the corners of the onboard frame, so a faceted cylinder edge
    // was very visible here.
    const tireGeometry = tyre(0.29, 0.215);
    const tire = new THREE.Mesh(tireGeometry, rubber);
    wheel.add(tire);
    const rimGeometry = rimBarrel(0.29, 0.225);
    const wheelRim = new THREE.Mesh(rimGeometry, rim);
    wheel.add(wheelRim);
    // Spokes, so the wheel reads as a wheel when it turns under braking.
    const spokeGeometry = spoke(0.29 * 0.16, 0.29 * 0.58, 0.29 * 0.3, 0.215 * 0.1);
    for (let i = 0; i < 7; i += 1) {
      const s = new THREE.Mesh(spokeGeometry, rim);
      s.rotation.x = (i / 7) * Math.PI * 2;
      s.position.x = -0.215 * 0.16;
      wheel.add(s);
    }
    this.disposables.push(spokeGeometry);
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
    this.steeringWheel.scale.setScalar(0.62);
    // Column rake is fixed on the mount; only the rim inside it spins. The sign
    // is positive so the top of the wheel leans back toward the driver — the
    // negative constant raked it forward, showing the driver its back face.
    this.steeringWheel.rotation.x = -COCKPIT.WHEEL_TILT_RAD;
    this.steeringWheel.add(this.wheelRim);
    this.group.add(this.steeringWheel);

    // Modern formula wheel: a flat-topped/flat-bottomed "butterfly" rim built
    // from two tube arcs, with moulded grips at 9 and 3 o'clock. The old wheel
    // was five boxes, which read as a plank right in the centre of the frame.
    // The arcs are centred on ±Y so the flat spots land at top and bottom.
    const rimRadius = 0.145;
    const arc = Math.PI * 0.62;
    for (const dir of [1, -1]) {
      const curve = new THREE.EllipseCurve(
        0,
        0,
        0.27,
        rimRadius,
        Math.PI / 2 - arc / 2,
        Math.PI / 2 + arc / 2,
        false,
        0,
      );
      const points = curve.getPoints(28).map((p) => new THREE.Vector3(p.x, p.y * dir, 0));
      const path = new THREE.CatmullRomCurve3(points);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 28, 0.019, 10, false), carbon);
      if (dir === 1) tube.name = 'cockpit-steering-wheel-rim';
      this.wheelRim.add(tube);
      this.disposables.push(tube.geometry);
    }

    // Contoured rubber grips the driver's hands wrap around.
    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.15, 6, 12), rubber);
      grip.position.set(side * 0.255, 0, 0.004);
      grip.rotation.z = side * 0.16;
      this.wheelRim.add(grip);
      this.disposables.push(grip.geometry);
    }

    // Central hub with a bevelled face carrying the display.
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.038), carbon);
    hub.position.set(0, 0, 0.004);
    this.wheelRim.add(hub);
    this.disposables.push(hub.geometry);

    // Live dash panel on the -Z face: that is the side the driver, who looks
    // toward +Z, actually sees. Paddles go on +Z, behind the rim.
    if (this.dashCanvas) {
      this.dashTexture = new THREE.CanvasTexture(this.dashCanvas);
      this.dashTexture.colorSpace = THREE.SRGBColorSpace;
      this.dashTexture.anisotropy = 4;
      const dashMaterial = new THREE.MeshBasicMaterial({ map: this.dashTexture, toneMapped: false });
      this.disposables.push(dashMaterial, this.dashTexture);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.152, 0.076), dashMaterial);
      // Must sit just proud of the bezel's front face (which reaches z=-0.025),
      // or the opaque bezel is drawn over the screen and it reads as blank.
      panel.position.set(0, 0.022, -0.027);
      // A plane's face points +Z; the driver looks toward +Z, so it must be
      // turned around or they only ever see its unlit back side.
      panel.rotation.y = Math.PI;
      this.wheelRim.add(panel);
      this.disposables.push(panel.geometry);
    }
    // Bezel behind the panel so it reads as a recessed screen.
    this.wheelBox(display, 0.162, 0.086, 0.026, 0, 0.022, -0.012);

    // Shift paddles behind the rim.
    for (const side of [-1, 1]) {
      const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.014), carbon);
      paddle.position.set(side * 0.15, -0.01, 0.045);
      paddle.rotation.y = side * 0.22;
      this.wheelRim.add(paddle);
      this.disposables.push(paddle.geometry);
    }

    // Shift lights across the top of the hub. Pitch is sized from the hub width
    // so the strip always fits inside it rather than overhanging the edges.
    const ledPitch = 0.19 / COCKPIT.SHIFT_LED_COUNT;
    const ledStart = ((COCKPIT.SHIFT_LED_COUNT - 1) / 2) * ledPitch;
    for (let i = 0; i < COCKPIT.SHIFT_LED_COUNT; i += 1) {
      const material = this.mat(0x10202a, 0.35, 0.05, null, 0);
      // The driver views the hub from -Z, so local +X appears on their LEFT.
      // Index 0 therefore starts at +X to make the strip fill left-to-right.
      const led = this.wheelBox(material, ledPitch * 0.72, 0.013, 0.012, ledStart - i * ledPitch, 0.062, -0.03);
      led.name = `cockpit-shift-led-${i}`;
      this.ledMaterials.push(material);
    }

    // Rotaries live on the hub's lower face, below the screen.
    this.rotary(cyan, -0.062, -0.052);
    this.rotary(amber, 0.062, -0.052);
    this.rotary(red, 0, -0.058);
  }

  /**
   * Redraw the wheel's screen with speed and gear. Only re-uploads the texture
   * when a displayed value actually changes, so this costs nothing per frame at
   * a standstill or a steady cruise.
   */
  private updateDash(speedMps: number, gear: number): void {
    const kmh = Math.max(0, Math.round(speedMps * 3.6));
    if (kmh === this.lastDash.kmh && gear === this.lastDash.gear) return;
    this.lastDash = { kmh, gear };

    if (!this.dashCanvas) return;
    const ctx = this.dashCanvas.getContext('2d');
    if (!ctx || !this.dashTexture) return;
    const { width: w, height: h } = this.dashCanvas;

    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, w, h);

    // Gear, large on the left — the value a driver glances for most often.
    ctx.fillStyle = '#f7fcff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.72)}px "Arial Narrow", Impact, sans-serif`;
    ctx.fillText(gearLabel(gear), w * 0.2, h * 0.52);

    // Speed on the right, with a small unit tag.
    ctx.fillStyle = '#22c8ff';
    ctx.font = `700 ${Math.round(h * 0.5)}px "Arial Narrow", Impact, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(String(kmh), w * 0.92, h * 0.45);
    ctx.fillStyle = '#8d97a3';
    ctx.font = `600 ${Math.round(h * 0.16)}px "Arial Narrow", sans-serif`;
    ctx.fillText('KM/H', w * 0.92, h * 0.8);

    // Divider between the two fields.
    ctx.strokeStyle = '#2b333d';
    ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath();
    ctx.moveTo(w * 0.38, h * 0.16);
    ctx.lineTo(w * 0.38, h * 0.84);
    ctx.stroke();

    this.dashTexture.needsUpdate = true;
  }

  private updateShiftLeds(rpm: number): void {
    const rpmFrac = Math.max(0, Math.min(1, rpm / 8600));
    const active = Math.round(Math.max(0, rpmFrac - COCKPIT.LED_RPM_START_FRAC) / (1 - COCKPIT.LED_RPM_START_FRAC) * COCKPIT.SHIFT_LED_COUNT);
    // LEDs are built left-to-right, and fill in that order as revs rise. The
    // ramp runs green -> amber -> red, so the red pair at the right-hand end is
    // the shift cue.
    const count = this.ledMaterials.length;
    for (let i = 0; i < count; i += 1) {
      const material = this.ledMaterials[i];
      const on = i < active;
      const frac = count > 1 ? i / (count - 1) : 0;
      const color = frac > 0.78 ? COLORS.CAR_BODY_ACCENT : frac > 0.44 ? COLORS.CAR_ACCENT_2 : COLORS.FORCE_LONGITUDINAL;
      material.color.setHex(on ? color : 0x10202a);
      material.emissive.setHex(on ? color : 0x000000);
      material.emissiveIntensity = on ? 0.85 : 0;
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
    this.wheelRim.add(mesh);
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
    const geometry = new THREE.CylinderGeometry(0.016, 0.016, 0.014, 14);
    const mesh = new THREE.Mesh(geometry, material);
    // -Z is the face the driver sees.
    mesh.position.set(x, y, -0.055);
    mesh.rotation.x = Math.PI / 2;
    this.wheelRim.add(mesh);
    this.disposables.push(geometry);
  }

  /** Add a lofted/curved geometry to the cockpit group and track it for disposal. */
  private addGeo(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    this.group.add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  private mat(color: number, roughness: number, metalness: number, env: THREE.Texture | null, envIntensity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      envMap: env,
      envMapIntensity: envIntensity,
      // Same reasoning as the external bodywork: the lofted panels are
      // thin-walled and open-ended, so never cull a face.
      side: THREE.DoubleSide,
    });
    this.disposables.push(m);
    return m;
  }
}

/**
 * Offscreen canvas for the steering-wheel screen. Sized as a 2:1 strip to match
 * the panel's aspect so text is not stretched. Returns null under a headless
 * test runner, where there is no DOM; the dash then simply does not draw.
 */
function createDashCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  return canvas;
}

/** Gear as the driver reads it: N for neutral, R for reverse. */
function gearLabel(gear: number): string {
  if (gear === 0) return 'N';
  if (gear < 0) return 'R';
  return String(gear);
}
