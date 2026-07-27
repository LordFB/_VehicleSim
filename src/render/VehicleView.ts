import * as THREE from 'three';
import { COLORS, VEHICLE_VIEW } from '../core/Constants';
import type { PhysicsSnapshot, VehicleSpec, WheelId } from '../sim/types';
import type { CameraMode } from './RaceCamera';
import { aerofoil, brakeDisc, endplate, helmet, loftBody, rimBarrel, sidepod, spoke, tyre, type Station } from './VehicleBodywork';

const WHEEL_IDS: WheelId[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * Formula 3 open-wheeler, driven by the physics snapshot. The body is modeled in
 * the chassis-origin frame (forward = +Z, so the nose and front wing sit at +Z)
 * so it lines up with the wheel hardpoints in the vehicle spec.
 *
 * The bodywork is lofted/lathed rather than assembled from boxes (see
 * VehicleBodywork.ts): the monocoque, nose, sidepods and engine cover are swept
 * superellipse sections, the wings are cambered aerofoils, and the tyres are
 * lathed profiles with rounded shoulders. That curvature is what makes the car
 * hold up on the external cameras (NOSE / TV / HELICOPTER / ORBIT), where flat
 * slabs previously read as a featureless dark mass with no highlights.
 */
export class VehicleView {
  readonly group = new THREE.Group();
  private readonly chassis: THREE.Group;
  private readonly wheels = new Map<WheelId, THREE.Group>();
  private readonly wheelMaterials = new Map<WheelId, THREE.MeshStandardMaterial>();
  private readonly brakeMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly suspensionArms: Array<{ link: THREE.Object3D; wheel: WheelId; anchor: THREE.Vector3; radius: number }> = [];
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly smoothedChassisOrientation = new THREE.Quaternion();
  private chassisSmoothingInitialized = false;

  constructor(spec: VehicleSpec, environment: THREE.Texture | null = null) {
    this.group.name = 'vehicle-view';

    this.chassis = new THREE.Group();
    this.chassis.name = 'vehicle-chassis';
    this.group.add(this.chassis);

    // Clearcoat-style carbon: dark but glossy, so curvature reads as highlights
    // instead of flat black. This is the main fix for the "black blob" look.
    const carbon = this.mat(COLORS.CAR_BODY, 0.34, 0.28, environment, 1.1);
    const gloss = this.mat(COLORS.CAR_BODY_ACCENT, 0.22, 0.15, environment, 1.25);
    const wing = this.mat(COLORS.CAR_WING, 0.3, 0.3, environment, 1.0);
    const accent2 = this.mat(COLORS.CAR_ACCENT_2, 0.28, 0.2, environment, 1.1);
    const suspension = this.mat(0x14171c, 0.36, 0.62, environment, 0.9);
    const driver = this.mat(0xe8eaee, 0.42, 0.05, environment, 0.5);
    const visor = this.mat(0x0b1016, 0.08, 0.9, environment, 1.6);
    const matteBlack = this.mat(0x0d1014, 0.72, 0.15, environment, 0.5);

    this.buildFloor(wing, carbon);
    this.buildTub(carbon, gloss, accent2);
    this.buildNoseAndFrontWing(carbon, gloss, wing, accent2);
    this.buildSidepods(gloss, carbon, matteBlack);
    this.buildCockpit(driver, carbon, visor, matteBlack);
    this.buildAirbox(carbon, gloss);
    this.buildRearWing(wing, gloss, accent2);

    this.buildWheels(spec, environment);
    this.buildSuspension(spec, suspension);
  }

  // ---- body construction -------------------------------------------------

  private buildFloor(wing: THREE.Material, carbon: THREE.Material): void {
    // Flat floor with a rolled edge, running the length of the car.
    const floorStations: Station[] = [
      { z: -2.2, halfWidth: 0.7, y: -0.36, top: 0.022, bottom: 0.022, squareness: 5 },
      { z: -1.0, halfWidth: 0.76, y: -0.36, top: 0.024, bottom: 0.024, squareness: 5 },
      { z: 0.6, halfWidth: 0.76, y: -0.36, top: 0.024, bottom: 0.024, squareness: 5 },
      { z: 1.7, halfWidth: 0.62, y: -0.36, top: 0.022, bottom: 0.022, squareness: 5 },
      { z: 2.15, halfWidth: 0.4, y: -0.36, top: 0.02, bottom: 0.02, squareness: 4 },
    ];
    this.addLoft(floorStations, wing, 16);

    // Rear diffuser: an upswept tunnel section under the gearbox.
    const diffuser: Station[] = [
      { z: -2.35, halfWidth: 0.66, y: -0.16, top: 0.03, bottom: 0.12, squareness: 4 },
      { z: -2.05, halfWidth: 0.68, y: -0.24, top: 0.03, bottom: 0.09, squareness: 4.5 },
      { z: -1.75, halfWidth: 0.7, y: -0.33, top: 0.028, bottom: 0.05, squareness: 5 },
    ];
    this.addLoft(diffuser, wing, 18);
    // Strakes dividing the diffuser tunnels.
    for (const x of [-0.4, -0.14, 0.14, 0.4]) {
      const strake = this.plate(carbon, 0.012, 0.1, 0.5);
      strake.position.set(x, -0.27, -2.05);
      strake.rotation.x = -0.22;
    }
  }

  private buildTub(carbon: THREE.Material, gloss: THREE.Material, accent2: THREE.Material): void {
    // Survival cell: a squared-off monocoque with filleted edges that tapers and
    // drops toward the nose, then blends into the engine cover behind the driver.
    const tub: Station[] = [
      { z: -1.75, halfWidth: 0.2, y: -0.12, top: 0.16, bottom: 0.14, squareness: 3.0 },
      { z: -1.3, halfWidth: 0.27, y: -0.1, top: 0.22, bottom: 0.18, squareness: 3.2 },
      { z: -0.75, halfWidth: 0.33, y: -0.08, top: 0.27, bottom: 0.2, squareness: 3.4 },
      { z: -0.2, halfWidth: 0.35, y: -0.08, top: 0.24, bottom: 0.21, squareness: 3.6 },
      { z: 0.35, halfWidth: 0.34, y: -0.09, top: 0.2, bottom: 0.22, squareness: 3.6 },
      { z: 0.95, halfWidth: 0.31, y: -0.11, top: 0.17, bottom: 0.21, squareness: 3.4 },
      { z: 1.35, halfWidth: 0.24, y: -0.12, top: 0.14, bottom: 0.18, squareness: 3.0 },
    ];
    this.addLoft(tub, carbon, 28);

    // Engine cover / shark fin sloping down to the rear axle.
    const cover: Station[] = [
      { z: -1.95, halfWidth: 0.11, y: -0.06, top: 0.1, bottom: 0.12, squareness: 2.6 },
      { z: -1.5, halfWidth: 0.18, y: -0.02, top: 0.15, bottom: 0.16, squareness: 2.8 },
      { z: -1.0, halfWidth: 0.24, y: 0.01, top: 0.19, bottom: 0.18, squareness: 3.0 },
      { z: -0.5, halfWidth: 0.26, y: 0.02, top: 0.2, bottom: 0.18, squareness: 3.0 },
      { z: -0.15, halfWidth: 0.24, y: 0.03, top: 0.19, bottom: 0.16, squareness: 2.8 },
    ];
    this.addLoft(cover, gloss, 22);

    // Livery stripes follow the deck; kept slightly proud to avoid z-fighting.
    const stripe = this.plate(accent2, 0.075, 0.012, 1.9);
    stripe.position.set(0, 0.115, 0.1);
    for (const x of [-0.13, 0.13]) {
      const pin = this.plate(gloss, 0.028, 0.011, 1.9);
      pin.position.set(x, 0.113, 0.1);
    }
  }

  private buildNoseAndFrontWing(
    carbon: THREE.Material,
    gloss: THREE.Material,
    wing: THREE.Material,
    accent2: THREE.Material,
  ): void {
    // Raised nose: a smoothly tapering loft ending in a rounded tip. The tip drops
    // toward the wing so nose and front wing read as one assembly.
    const nose: Station[] = [
      { z: 1.3, halfWidth: 0.25, y: -0.11, top: 0.14, bottom: 0.17, squareness: 3.0 },
      { z: 1.75, halfWidth: 0.21, y: -0.13, top: 0.12, bottom: 0.15, squareness: 2.8 },
      { z: 2.1, halfWidth: 0.16, y: -0.17, top: 0.1, bottom: 0.12, squareness: 2.5 },
      { z: 2.36, halfWidth: 0.11, y: -0.21, top: 0.075, bottom: 0.09, squareness: 2.2 },
      { z: 2.56, halfWidth: 0.06, y: -0.25, top: 0.05, bottom: 0.055, squareness: 2.0 },
    ];
    this.addLoft(nose, gloss, 22);

    // Front wing: two cambered elements spanning wider than the tyres, sitting
    // just under the nose tip so the assembly reads as one piece.
    const z = 2.42;
    const main = this.addGeo(aerofoil({ span: 1.62, chord: 0.34, thickness: 0.03, camber: 0.022 }), wing);
    main.position.set(0, -0.31, z);
    const flap = this.addGeo(
      aerofoil({ span: 1.54, chord: 0.2, thickness: 0.022, camber: 0.03, incidence: 0.26 }),
      accent2,
    );
    flap.position.set(0, -0.25, z - 0.24);

    // Endplates with a raked leading edge, turning the flow out around the tyres.
    // Painted in the livery rather than carbon so they do not read as black voids
    // hanging off the wing tips.
    for (const side of [-1, 1]) {
      const plate = this.addGeo(endplate({ length: 0.44, height: 0.14, thickness: 0.012, sweep: 0.5 }), gloss);
      plate.position.set(side * 0.8, -0.285, z - 0.05);
      plate.rotation.y = side * 0.06;
    }
    // Pylons hanging the wing off the nose underside. They span the gap between
    // the wing's upper surface and the nose tip so the assembly reads as bolted
    // together rather than floating.
    for (const side of [-1, 1]) {
      const pylon = this.plate(carbon, 0.026, 0.1, 0.16);
      pylon.position.set(side * 0.1, -0.275, z - 0.06);
      pylon.rotation.x = 0.18;
    }
  }

  private buildSidepods(gloss: THREE.Material, carbon: THREE.Material, matte: THREE.Material): void {
    for (const side of [-1, 1]) {
      // Lofted pod with a coke-bottle pinch at the tail — this replaces the flat
      // red brick that dominated the old side view. Kept between the axles and
      // narrower than the tub's shoulder so the car does not read as bloated.
      const pod = this.addGeo(
        sidepod({ length: 1.2, maxHalfWidth: 0.19, height: 0.32, tailPinch: 0.26 }),
        gloss,
      );
      pod.position.set(side * 0.5, -0.18, -0.15);

      // Recessed radiator inlet: a dark inner box set back inside the mouth so
      // the opening reads as a duct rather than a painted rectangle.
      const mouth = this.plate(matte, 0.24, 0.18, 0.06);
      mouth.position.set(side * 0.5, -0.17, 0.4);

      // Undercut lip along the pod's lower edge.
      const lip = this.plate(carbon, 0.05, 0.018, 1.0);
      lip.position.set(side * 0.59, -0.32, -0.2);
      lip.rotation.z = side * 0.22;

      // Winglet on the pod shoulder.
      const winglet = this.addGeo(
        aerofoil({ span: 0.24, chord: 0.14, thickness: 0.014, camber: 0.014, incidence: 0.18 }),
        carbon,
      );
      winglet.position.set(side * 0.56, -0.02, 0.24);
      winglet.rotation.z = side * -0.12;
    }
  }

  private buildCockpit(driver: THREE.Material, carbon: THREE.Material, visor: THREE.Material, matte: THREE.Material): void {
    // Padded coaming ring around the opening.
    const ring = this.addGeo(new THREE.TorusGeometry(0.27, 0.038, 12, 28), carbon);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(1.05, 0.78, 1);
    ring.position.set(0, 0.115, 0.44);

    // Shallow dark recess inside the coaming so the opening reads as a cockpit
    // rather than a hole punched through the deck.
    const interior = this.addGeo(new THREE.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), matte);
    interior.rotation.x = Math.PI;
    interior.scale.set(0.92, 0.3, 1.12);
    interior.position.set(0, 0.115, 0.44);

    // Driver: helmet with a visor band, plus shoulders filling the tub opening.
    const lid = this.addGeo(helmet(0.145), driver);
    lid.position.set(0, 0.2, 0.33);
    const band = this.addGeo(new THREE.SphereGeometry(0.147, 20, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.2), visor);
    band.scale.set(0.94, 1, 1.14);
    band.position.set(0, 0.2, 0.34);
    band.rotation.x = -0.12;

    const shoulders = this.addGeo(new THREE.CapsuleGeometry(0.1, 0.24, 6, 12), driver);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.set(0, 0.08, 0.5);

    // Halo: the modern open-wheel silhouette cue, a hoop over the opening.
    const halo = new THREE.Group();
    const hoop = this.addGeo(new THREE.TorusGeometry(0.3, 0.026, 10, 28, Math.PI), carbon, halo);
    hoop.rotation.x = Math.PI / 2;
    hoop.rotation.z = Math.PI;
    hoop.scale.set(1.0, 0.86, 1);
    const post = this.addGeo(new THREE.CylinderGeometry(0.028, 0.034, 0.2, 10), carbon, halo);
    post.position.set(0, -0.08, 0.31);
    post.rotation.x = 0.22;
    halo.position.set(0, 0.26, 0.4);
    this.chassis.add(halo);

    // Mirrors on stalks, visible from the side and rear cameras.
    for (const side of [-1, 1]) {
      const stalk = this.plate(carbon, 0.11, 0.016, 0.02);
      stalk.position.set(side * 0.31, 0.13, 0.6);
      const housing = this.addGeo(new THREE.BoxGeometry(0.1, 0.055, 0.05), carbon);
      housing.position.set(side * 0.38, 0.14, 0.6);
      housing.rotation.y = side * -0.2;
    }
  }

  private buildAirbox(carbon: THREE.Material, gloss: THREE.Material): void {
    // Roll hoop / airbox behind the driver's head, blended into the engine cover.
    const airbox: Station[] = [
      { z: -0.42, halfWidth: 0.14, y: 0.14, top: 0.11, bottom: 0.14, squareness: 2.6 },
      { z: -0.2, halfWidth: 0.15, y: 0.17, top: 0.12, bottom: 0.16, squareness: 2.6 },
      { z: 0.02, halfWidth: 0.14, y: 0.18, top: 0.11, bottom: 0.16, squareness: 2.4 },
      { z: 0.16, halfWidth: 0.115, y: 0.17, top: 0.09, bottom: 0.14, squareness: 2.2 },
    ];
    this.addLoft(airbox, carbon, 20);
    // Intake mouth: a dark recess facing forward under the hoop.
    const intake = this.addGeo(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 16), gloss);
    intake.rotation.x = Math.PI / 2;
    intake.position.set(0, 0.185, 0.19);
  }

  private buildRearWing(wing: THREE.Material, gloss: THREE.Material, accent2: THREE.Material): void {
    // Sits just behind the rear axle, low enough to stay in the car's silhouette.
    const z = -1.86;
    // Main plane + upper flap, both cambered aerofoils on a swan-neck mount.
    const main = this.addGeo(aerofoil({ span: 1.1, chord: 0.3, thickness: 0.028, camber: -0.026, incidence: -0.1 }), wing);
    main.position.set(0, 0.24, z);
    const flap = this.addGeo(
      aerofoil({ span: 1.08, chord: 0.17, thickness: 0.022, camber: -0.03, incidence: -0.34 }),
      accent2,
    );
    flap.position.set(0, 0.33, z - 0.14);

    for (const side of [-1, 1]) {
      const plate = this.addGeo(endplate({ length: 0.52, height: 0.36, thickness: 0.016, sweep: 0.3 }), wing);
      plate.position.set(side * 0.56, 0.26, z - 0.04);
    }
    // Swan-neck pylon rising from the gearbox to the main plane's underside.
    const pylon = this.plate(gloss, 0.05, 0.26, 0.11);
    pylon.position.set(0, 0.1, z + 0.05);
    // Rear crash structure / gearbox fairing.
    const gearbox: Station[] = [
      { z: -2.15, halfWidth: 0.08, y: -0.1, top: 0.07, bottom: 0.07, squareness: 2.4 },
      { z: -1.95, halfWidth: 0.1, y: -0.09, top: 0.09, bottom: 0.09, squareness: 2.6 },
      { z: -1.72, halfWidth: 0.12, y: -0.07, top: 0.11, bottom: 0.11, squareness: 2.8 },
    ];
    this.addLoft(gearbox, wing, 16);
  }

  // ---- wheels & suspension ----------------------------------------------

  private buildWheels(spec: VehicleSpec, environment: THREE.Texture | null): void {
    const tireProto = this.mat(COLORS.WHEEL, 0.62, 0.05, environment, 0.35);
    const rimMat = this.mat(COLORS.CAR_RIM, 0.22, 0.95, environment, 1.4);
    const discProto = this.mat(COLORS.CAR_DISC, 0.5, 0.25, environment, 0.5);
    const caliperMat = this.mat(COLORS.CAR_ACCENT_2, 0.35, 0.55, environment, 0.9);
    this.disposables.push(rimMat, caliperMat);

    for (const wheelSpec of spec.wheels) {
      const wheelGroup = new THREE.Group();
      wheelGroup.name = `wheel-${wheelSpec.id}`;
      const r = wheelSpec.tire.radius;
      const width = wheelSpec.tire.width;

      // Lathed slick with a crowned tread and rounded shoulders.
      const tireMaterial = tireProto.clone();
      const tireGeo = tyre(r, width);
      const tire = new THREE.Mesh(tireGeo, tireMaterial);
      tire.castShadow = true;
      wheelGroup.add(tire);
      this.disposables.push(tireGeo, tireMaterial);

      // Rim barrel + spokes, recessed inside the bead.
      const barrelGeo = rimBarrel(r, width);
      const barrel = new THREE.Mesh(barrelGeo, rimMat);
      wheelGroup.add(barrel);
      this.disposables.push(barrelGeo);

      const spokeGeo = spoke(r * 0.16, r * 0.58, r * 0.3, width * 0.1);
      this.disposables.push(spokeGeo);
      for (let i = 0; i < 7; i += 1) {
        const s = new THREE.Mesh(spokeGeo, rimMat);
        s.rotation.x = (i / 7) * Math.PI * 2;
        s.position.x = -width * 0.16;
        wheelGroup.add(s);
      }

      // Brake disc glowing under load, plus a caliper clamped over it.
      const discMaterial = discProto.clone();
      const discGeo = brakeDisc(r * 0.6, width * 0.14);
      const disc = new THREE.Mesh(discGeo, discMaterial);
      wheelGroup.add(disc);
      this.disposables.push(discGeo, discMaterial);
      this.brakeMaterials.push(discMaterial);

      const caliperGeo = new THREE.BoxGeometry(width * 0.3, r * 0.34, r * 0.2);
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(0, r * 0.5, -r * 0.1);
      wheelGroup.add(caliper);
      this.disposables.push(caliperGeo);

      this.group.add(wheelGroup);
      this.wheels.set(wheelSpec.id, wheelGroup);
      this.wheelMaterials.set(wheelSpec.id, tireMaterial);
    }
  }

  /**
   * Visible inboard suspension links (wishbones + pushrod) from the tub to each
   * wheel. Each link is rebuilt every frame from the live tub and wheel poses so
   * the arms stay attached as the suspension travels — this is the open-wheel read.
   */
  private buildSuspension(spec: VehicleSpec, mat: THREE.Material): void {
    // Unit-radius, unit-length cylinder along +Y; scaled per-frame to span
    // anchor -> wheel.
    const linkGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.disposables.push(linkGeo);
    for (const wheelSpec of spec.wheels) {
      const sign = Math.sign(wheelSpec.localPosition[0]);
      const z = wheelSpec.localPosition[2];
      // Wishbones pick up on the tub's outer flank rather than the centreline, so
      // the arms stay in the gap between body and wheel instead of raking across
      // the bodywork. Lower pair splayed fore/aft, upper pair narrower, plus a
      // pushrod — the classic A-arm read without a thicket of links.
      const layout: Array<{ offset: THREE.Vector3; radius: number }> = [
        { offset: new THREE.Vector3(sign * 0.33, -0.31, z + 0.26), radius: 0.016 },
        { offset: new THREE.Vector3(sign * 0.33, -0.31, z - 0.26), radius: 0.016 },
        { offset: new THREE.Vector3(sign * 0.3, -0.12, z + 0.19), radius: 0.013 },
        { offset: new THREE.Vector3(sign * 0.3, -0.12, z - 0.19), radius: 0.013 },
        { offset: new THREE.Vector3(sign * 0.28, -0.05, z - 0.03), radius: 0.011 },
      ];
      for (const { offset, radius } of layout) {
        const link = new THREE.Mesh(linkGeo, mat);
        link.castShadow = false;
        this.group.add(link);
        this.suspensionArms.push({ link, wheel: wheelSpec.id, anchor: offset, radius });
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
      arm.link.scale.set(arm.radius, len, arm.radius);
    }
  }

  // ---- helpers -----------------------------------------------------------

  private mat(color: number, roughness: number, metalness: number, env: THREE.Texture | null, envIntensity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      envMap: env,
      envMapIntensity: envIntensity,
      // The lofted bodywork is open-ended in places and thin-walled throughout,
      // so render both faces: a back-facing triangle anywhere in the sweep would
      // otherwise punch a hole straight through the car.
      side: THREE.DoubleSide,
    });
    this.disposables.push(m);
    return m;
  }

  /** Add a geometry to the chassis (or another parent) and track it for disposal. */
  private addGeo(geometry: THREE.BufferGeometry, material: THREE.Material, parent?: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    (parent ?? this.chassis).add(mesh);
    this.disposables.push(geometry);
    return mesh;
  }

  private addLoft(stations: Station[], material: THREE.Material, radialSegments: number): THREE.Mesh {
    return this.addGeo(loftBody(stations, radialSegments), material);
  }

  /** A small box panel — still the right primitive for strakes, lips and pylons. */
  private plate(material: THREE.Material, sx: number, sy: number, sz: number): THREE.Mesh {
    return this.addGeo(new THREE.BoxGeometry(sx, sy, sz), material);
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
    this.applyBrakeGlow(snapshot);
    this.orientLinks();
  }

  /** Brake discs heat up under braking — a cheap, readable cue on external cameras. */
  private applyBrakeGlow(snapshot: PhysicsSnapshot): void {
    const brake = Math.max(0, Math.min(1, snapshot.telemetry?.brake ?? 0));
    const speedT = Math.min(1, Math.abs(snapshot.telemetry?.speedMps ?? 0) / 45);
    const glow = brake * speedT;
    for (const material of this.brakeMaterials) {
      material.emissive.setHex(0xff3b12);
      material.emissiveIntensity = glow * 0.9;
    }
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

function setPose(object: THREE.Object3D, position: [number, number, number], orientation: [number, number, number, number]): void {
  object.position.set(position[0], position[1], position[2]);
  object.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
}

function frameAlpha(lerp: number, delta: number): number {
  return 1 - Math.pow(1 - lerp, delta * 60);
}
