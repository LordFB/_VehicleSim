import * as THREE from 'three';
import { COLORS, VEHICLE_VIEW } from '../core/Constants';
import type { PhysicsSnapshot, VehicleSpec, WheelId } from '../sim/types';
import type { CameraMode } from './RaceCamera';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * Formula 3 open-wheeler, composed from primitives and driven by the physics
 * snapshot. The body is modeled in the chassis-origin frame (forward = +Z, so the
 * nose and front wing sit at +Z) so it lines up with the wheel hardpoints in the
 * vehicle spec. Identity cues an F3 fan recognizes instantly: exposed wheels on
 * visible suspension arms, a low pointed nose feeding a full-width multi-element
 * front wing, sidepods, an airbox behind the driver, the halo over the cockpit,
 * and a high rear wing above a diffuser.
 */
export class VehicleView {
  readonly group = new THREE.Group();
  private readonly chassis: THREE.Group;
  private readonly wheels = new Map<WheelId, THREE.Group>();
  private readonly wheelMaterials = new Map<WheelId, THREE.MeshStandardMaterial>();
  private readonly suspensionArms: Array<{ link: THREE.Object3D; wheel: WheelId; anchor: THREE.Vector3 }> = [];
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly smoothedChassisOrientation = new THREE.Quaternion();
  private chassisSmoothingInitialized = false;

  constructor(spec: VehicleSpec, environment: THREE.Texture | null = null) {
    this.group.name = 'vehicle-view';

    this.chassis = new THREE.Group();
    this.chassis.name = 'vehicle-chassis';
    this.group.add(this.chassis);

    const carbon = this.mat(COLORS.CAR_BODY, 0.45, 0.35, environment, 0.7);
    const wing = this.mat(COLORS.CAR_WING, 0.5, 0.2, environment, 0.5);
    const accent = this.mat(COLORS.CAR_BODY_ACCENT, 0.35, 0.25, environment, 0.6);
    const accent2 = this.mat(COLORS.CAR_ACCENT_2, 0.4, 0.3, environment, 0.6);
    const halo = this.mat(COLORS.CAR_HALO, 0.55, 0.6, environment, 0.5);
    const driver = this.mat(COLORS.CAR_DRIVER, 0.6, 0.1, null, 0);

    this.buildFloor(wing);
    this.buildTub(carbon, accent, accent2);
    this.buildNoseAndFrontWing(carbon, accent, wing);
    this.buildSidepods(carbon, accent);
    this.buildCockpit(driver, carbon);
    this.buildAirbox(carbon, accent);
    this.buildHalo(halo);
    this.buildRearWing(wing, accent);

    // Tiny aero pieces do not need individual shadow-map draws. The four tires
    // carry the contact shadow, while direct lighting still shapes the body.

    this.buildWheels(spec, environment);
    this.buildSuspension(spec, halo);
  }

  // ---- body construction -------------------------------------------------

  private buildFloor(mat: THREE.Material): void {
    // Flat floor + plank running the length, low to the ground (ride height read).
    this.box(mat, 1.5, 0.04, 4.4, 0, -0.36, -0.05);
    // Rear diffuser ramp.
    const diff = this.box(mat, 1.35, 0.18, 0.5, 0, -0.3, -1.95);
    diff.rotation.x = -0.35;
  }

  private buildTub(carbon: THREE.Material, accent: THREE.Material, accent2: THREE.Material): void {
    // Survival cell: a long, low, narrow monocoque that tapers toward the nose.
    const tubGeo = new THREE.BoxGeometry(0.62, 0.4, 2.6);
    taperBoxZ(tubGeo, 0.42, 1.0); // narrow + shallow at the front (+Z) end
    const tub = new THREE.Mesh(tubGeo, carbon);
    tub.position.set(0, -0.12, 0.15);
    this.chassis.add(tub);
    this.disposables.push(tubGeo);

    // Livery panels sit clear of one another to avoid coplanar depth flicker.
    this.box(accent, 0.24, 0.018, 2.2, 0, 0.112, 0.2);
    this.box(accent2, 0.035, 0.016, 2.2, -0.16, 0.122, 0.2);
    this.box(accent2, 0.035, 0.016, 2.2, 0.16, 0.122, 0.2);
    // Engine cover sloping down behind the cockpit toward the rear axle.
    const cover = new THREE.Mesh(taper(new THREE.BoxGeometry(0.5, 0.34, 1.3), 0.5, 0.2), accent);
    cover.position.set(0, -0.04, -1.05);
    this.chassis.add(cover);
  }

  private buildNoseAndFrontWing(carbon: THREE.Material, accent: THREE.Material, wing: THREE.Material): void {
    // Raised nose cone tapering to a fine tip well ahead of the front axle.
    const noseGeo = taper(new THREE.BoxGeometry(0.34, 0.26, 1.5), 0.12, 1.0);
    const nose = new THREE.Mesh(noseGeo, carbon);
    nose.position.set(0, -0.06, 1.45);
    this.chassis.add(nose);
    // Accent on the nose tip.
    const tip = new THREE.Mesh(taper(new THREE.BoxGeometry(0.16, 0.14, 0.5), 0.05, 1.0), accent);
    tip.position.set(0, -0.07, 2.16);
    this.chassis.add(tip);

    // Front wing: full-width (wider than the body), low, two stacked planes + endplates.
    const z = 2.35;
    this.box(wing, 1.7, 0.03, 0.34, 0, -0.28, z);
    const flap = this.box(accent, 1.6, 0.03, 0.16, 0, -0.2, z - 0.16);
    flap.rotation.x = 0.22;
    // Endplates turning up at each tip.
    this.box(wing, 0.04, 0.22, 0.42, 0.85, -0.2, z);
    this.box(wing, 0.04, 0.22, 0.42, -0.85, -0.2, z);
    // Nose pylons connecting wing to nose.
    this.box(carbon, 0.05, 0.2, 0.1, 0.18, -0.18, z + 0.02);
    this.box(carbon, 0.05, 0.2, 0.1, -0.18, -0.18, z + 0.02);
  }

  private buildSidepods(carbon: THREE.Material, accent: THREE.Material): void {
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(taper(new THREE.BoxGeometry(0.42, 0.34, 1.5), 0.45, 0.9), accent);
      pod.position.set(side * 0.62, -0.18, -0.45);
      this.chassis.add(pod);
      // Radiator inlet mouth (dark) facing forward.
      this.box(carbon, 0.3, 0.2, 0.05, side * 0.62, -0.16, 0.32);
    }
  }

  private buildCockpit(driver: THREE.Material, carbon: THREE.Material): void {
    // Cockpit coaming around the opening.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.04, 8, 20), carbon);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1, 0.7, 1);
    ring.position.set(0, 0.11, 0.42);
    this.chassis.add(ring);
    this.disposables.push(ring.geometry);
    // Helmet just visible above the coaming.
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), driver);
    helmet.scale.set(1, 1.05, 1.15);
    helmet.position.set(0, 0.2, 0.34);
    this.chassis.add(helmet);
    this.disposables.push(helmet.geometry);
  }

  private buildAirbox(carbon: THREE.Material, accent: THREE.Material): void {
    // Roll hoop / airbox behind the driver's head feeding the engine intake.
    const hoop = new THREE.Mesh(taper(new THREE.BoxGeometry(0.3, 0.34, 0.5), 0.7, 0.85), carbon);
    hoop.position.set(0, 0.18, 0.02);
    hoop.rotation.x = -0.12;
    this.chassis.add(hoop);
    // Intake snorkel mouth.
    this.box(accent, 0.16, 0.12, 0.06, 0, 0.3, 0.2);
  }

  private buildHalo(halo: THREE.Material): void {
    // Halo: two side rails sweeping from behind the cockpit forward to a single
    // central front pillar — the unmistakable modern single-seater cue.
    const rail = new THREE.TorusGeometry(0.3, 0.028, 8, 16, Math.PI);
    for (const side of [-1, 1]) {
      const arc = new THREE.Mesh(rail, halo);
      arc.position.set(side * 0.23, 0.16, 0.42);
      arc.rotation.set(Math.PI / 2, 0, 0);
      arc.scale.set(1, 1.5, 1);
      this.chassis.add(arc);
    }
    this.disposables.push(rail);
    // Front central pillar down to the chassis ahead of the cockpit.
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 8), halo);
    pillar.position.set(0, 0.24, 0.78);
    pillar.rotation.x = 0.2;
    this.chassis.add(pillar);
    this.disposables.push(pillar.geometry);
    // Top spar joining the two arcs over the driver.
    this.box(halo, 0.05, 0.05, 0.7, 0, 0.42, 0.4);
  }

  private buildRearWing(wing: THREE.Material, accent: THREE.Material): void {
    const z = -1.95;
    // Twin endplates.
    this.box(wing, 0.04, 0.4, 0.6, 0.62, 0.18, z);
    this.box(wing, 0.04, 0.4, 0.6, -0.62, 0.18, z);
    // Main plane + upper flap (accent), held high above the diffuser.
    this.box(wing, 1.2, 0.04, 0.34, 0, 0.34, z);
    const flap = this.box(accent, 1.2, 0.04, 0.2, 0, 0.24, z - 0.16);
    flap.rotation.x = 0.3;
    // Central swan-neck mount.
    this.box(wing, 0.06, 0.36, 0.1, 0, 0.0, z + 0.05);
  }

  // ---- wheels & suspension ----------------------------------------------

  private buildWheels(spec: VehicleSpec, environment: THREE.Texture | null): void {
    const tireProto = this.mat(COLORS.WHEEL, 0.85, 0.04, null, 0);
    const rimMat = this.mat(COLORS.CAR_RIM, 0.3, 0.85, environment, 1.0);
    const discMat = this.mat(COLORS.CAR_DISC, 0.55, 0.2, null, 0);
    this.disposables.push(rimMat, discMat);

    for (const wheelSpec of spec.wheels) {
      const wheelGroup = new THREE.Group();
      wheelGroup.name = `wheel-${wheelSpec.id}`;
      const r = wheelSpec.tire.radius;
      const width = wheelSpec.tire.width;

      const tireMaterial = tireProto.clone();
      // Slick tyre: a fat low-profile cylinder with a subtly bulged shoulder.
      const tireGeo = new THREE.CylinderGeometry(r, r, width, 20);
      const tire = new THREE.Mesh(tireGeo, tireMaterial);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wheelGroup.add(tire);
      this.disposables.push(tireGeo, tireMaterial);

      // Brake disc inboard of the rim.
      const discGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, width * 0.18, 16);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.z = Math.PI / 2;
      wheelGroup.add(disc);
      this.disposables.push(discGeo);

      // A recessed forged wheel avoids six overlapping meshes per corner.
      const rim = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.39, r * 0.39, width * 0.22, 16), rimMat);
      hub.rotation.z = Math.PI / 2;
      rim.add(hub);
      this.disposables.push(hub.geometry);
      const rimRingGeo = new THREE.TorusGeometry(r * 0.42, r * 0.075, 6, 16);
      const rimRing = new THREE.Mesh(rimRingGeo, rimMat);
      rimRing.rotation.y = Math.PI / 2;
      rim.add(rimRing);
      this.disposables.push(rimRingGeo);
      wheelGroup.add(rim);

      this.group.add(wheelGroup);
      this.wheels.set(wheelSpec.id, wheelGroup);
      this.wheelMaterials.set(wheelSpec.id, tireMaterial);
    }
  }

  /**
   * Visible inboard suspension links (lower wishbone + pushrod) from the tub to each
   * wheel. Each link is rebuilt every frame from the live tub and wheel poses so the
   * arms stay attached as the suspension travels — this is the open-wheel read.
   */
  private buildSuspension(spec: VehicleSpec, mat: THREE.Material): void {
    const linkGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
    this.disposables.push(linkGeo);
    for (const wheelSpec of spec.wheels) {
      // Inboard anchor near the tub, roughly under the floor on the car centreline side.
      const anchor = new THREE.Vector3(Math.sign(wheelSpec.localPosition[0]) * 0.22, -0.28, wheelSpec.localPosition[2]);
      for (let i = 0; i < 2; i += 1) {
        const link = new THREE.Mesh(linkGeo, mat);
        link.castShadow = false;
        this.group.add(link);
        this.suspensionArms.push({ link, wheel: wheelSpec.id, anchor: anchor.clone().add(new THREE.Vector3(0, i === 0 ? 0.04 : 0.16, 0)) });
      }
    }
  }

  private orientLinks(): void {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (const arm of this.suspensionArms) {
      const wheel = this.wheels.get(arm.wheel);
      if (!wheel) continue;
      // Anchor is in chassis-origin space; transform through the chassis pose.
      a.copy(arm.anchor).applyQuaternion(this.chassis.quaternion).add(this.chassis.position);
      b.copy(wheel.position);
      mid.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-4) continue;
      dir.normalize();
      q.setFromUnitVectors(up, dir);
      arm.link.position.copy(mid);
      arm.link.quaternion.copy(q);
      arm.link.scale.set(1, len, 1);
    }
  }

  // ---- helpers -----------------------------------------------------------

  private mat(color: number, roughness: number, metalness: number, env: THREE.Texture | null, envIntensity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMap: env, envMapIntensity: envIntensity });
    this.disposables.push(m);
    return m;
  }

  private box(material: THREE.Material, sx: number, sy: number, sz: number, px: number, py: number, pz: number): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(px, py, pz);
    this.chassis.add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  applySnapshot(snapshot: PhysicsSnapshot, delta = 1 / 60): void {
    this.applyChassisPose(snapshot, delta);
    for (const id of WHEEL_IDS) {
      const wheel = this.wheels.get(id);
      const wheelSnapshot = snapshot.wheels[id];
      if (!wheel || !wheelSnapshot) continue;
      setPose(wheel, wheelSnapshot.pose.position, wheelSnapshot.pose.orientation);
      const telemetry = snapshot.telemetry.wheels[id];
      const material = this.wheelMaterials.get(id);
      if (material && telemetry) material.color.setHex(COLORS.WHEEL);
    }
    this.orientLinks();
  }

  resetSmoothing(): void {
    this.chassisSmoothingInitialized = false;
  }

  setCameraMode(mode: CameraMode): void {
    this.chassis.visible = mode !== 'onboard';
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private applyChassisPose(snapshot: PhysicsSnapshot, delta: number): void {
    this.chassis.position.set(
      snapshot.chassis.position[0],
      snapshot.chassis.position[1],
      snapshot.chassis.position[2],
    );
    const target = new THREE.Quaternion(
      snapshot.chassis.orientation[0],
      snapshot.chassis.orientation[1],
      snapshot.chassis.orientation[2],
      snapshot.chassis.orientation[3],
    );
    if (!this.chassisSmoothingInitialized) {
      this.smoothedChassisOrientation.copy(target);
      this.chassisSmoothingInitialized = true;
    } else {
      this.smoothedChassisOrientation.slerp(target, frameAlpha(VEHICLE_VIEW.CHASSIS_ORIENTATION_LERP, delta));
    }
    this.chassis.quaternion.copy(this.smoothedChassisOrientation);
  }
}

/** Taper a box geometry's +Z end in X (and optionally Y) by the given scale factors. */
function taperBoxZ(geo: THREE.BufferGeometry, xScaleAtFront: number, yScaleAtFront: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const zMin = bb.min.z;
  const zMax = bb.max.z;
  for (let i = 0; i < pos.count; i += 1) {
    const z = pos.getZ(i);
    const t = (z - zMin) / Math.max(zMax - zMin, 1e-6); // 0 at back .. 1 at front
    const sx = 1 + (xScaleAtFront - 1) * t;
    const sy = 1 + (yScaleAtFront - 1) * t;
    pos.setX(i, pos.getX(i) * sx);
    pos.setY(i, pos.getY(i) * sy);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** Convenience: returns a tapered box geometry (taper applied in place). */
function taper(geo: THREE.BoxGeometry, xScaleAtFront: number, yScaleAtFront: number): THREE.BoxGeometry {
  taperBoxZ(geo, xScaleAtFront, yScaleAtFront);
  return geo;
}

function setPose(object: THREE.Object3D, position: [number, number, number], orientation: [number, number, number, number]): void {
  object.position.set(position[0], position[1], position[2]);
  object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
}

function frameAlpha(lerp: number, delta: number): number {
  return 1 - Math.pow(1 - lerp, delta * 60);
}
