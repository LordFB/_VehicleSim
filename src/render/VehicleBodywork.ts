import * as THREE from 'three';

/**
 * Geometry builders for the vehicle bodywork.
 *
 * The car used to be assembled from axis-aligned boxes, which read as a stack of
 * slabs from any camera that was not the cockpit: no curvature to catch a
 * highlight, hard square edges everywhere, and visible seams where panels met.
 * These helpers build the same shapes out of swept/lofted surfaces instead, so
 * the bodywork has continuous curvature and rounded edges that pick up the sun.
 *
 * Convention matches VehicleView: chassis-local frame with forward = +Z, up = +Y.
 */

/** A cross-section of the body at one station along +Z. */
export type Station = {
  /** Position along the car's length (metres, +Z is forward). */
  z: number;
  /** Half-width of the section. */
  halfWidth: number;
  /** Section centre height. */
  y: number;
  /** Height above centre. */
  top: number;
  /** Depth below centre. */
  bottom: number;
  /**
   * Superellipse exponent. 2 = ellipse, higher = squarer with rounded corners.
   * This is what gives a monocoque its flat-sided-but-filleted read.
   */
  squareness?: number;
};

/**
 * Loft a closed tube through a list of cross-sections. Each section is sampled as
 * a superellipse, so a single call can produce a rounded nose cone, a squared-off
 * monocoque with filleted edges, or an engine cover, depending on `squareness`.
 *
 * Sections must be ordered by increasing z. Radial resolution is `radialSegments`.
 */
export function loftBody(stations: Station[], radialSegments = 20, capEnds = true): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = stations.map((s) => sampleSection(s, radialSegments));
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (const p of ring) positions.push(p.x, p.y, p.z);
  }

  const ringCount = rings.length;
  for (let r = 0; r < ringCount - 1; r += 1) {
    const a = r * radialSegments;
    const b = (r + 1) * radialSegments;
    for (let i = 0; i < radialSegments; i += 1) {
      const j = (i + 1) % radialSegments;
      // Sections are sampled counter-clockwise in XY while rings advance along
      // +Z, so the outward-facing winding is i -> j -> next-ring. Reversing these
      // two triangles points every normal into the body, which renders the far
      // interior wall instead of the near surface.
      indices.push(a + i, a + j, b + i);
      indices.push(a + j, b + j, b + i);
    }
  }

  if (capEnds) {
    // Fan-cap both ends around a centre vertex so the body is watertight.
    const capFront = positions.length / 3;
    const front = stations[stations.length - 1];
    positions.push(0, front.y, front.z);
    const frontRing = (ringCount - 1) * radialSegments;
    for (let i = 0; i < radialSegments; i += 1) {
      const j = (i + 1) % radialSegments;
      // Front cap faces +Z, back cap faces -Z; both wound to match the shell.
      indices.push(capFront, frontRing + i, frontRing + j);
    }
    const capBack = positions.length / 3;
    const back = stations[0];
    positions.push(0, back.y, back.z);
    for (let i = 0; i < radialSegments; i += 1) {
      const j = (i + 1) % radialSegments;
      indices.push(capBack, j, i);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Sample one superellipse cross-section into a ring of points. */
function sampleSection(s: Station, segments: number): THREE.Vector3[] {
  const n = s.squareness ?? 2;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    // Superellipse: |x|^n + |y|^n = 1, evaluated parametrically.
    const px = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * s.halfWidth;
    const vertical = sn >= 0 ? s.top : s.bottom;
    const py = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n) * vertical;
    points.push(new THREE.Vector3(px, s.y + py, s.z));
  }
  return points;
}

/**
 * A wing element: a cambered aerofoil section extruded across the span, with a
 * slight taper and rounded tips. Replaces the flat plates the wings used to be —
 * an aerofoil catches light along its leading edge and reads as a real wing.
 */
export function aerofoil(options: {
  span: number;
  chord: number;
  thickness: number;
  camber: number;
  /** Radians of nose-down/up twist applied about the span axis. */
  incidence?: number;
  segments?: number;
}): THREE.BufferGeometry {
  const { span, chord, thickness, camber } = options;
  const incidence = options.incidence ?? 0;
  const segments = options.segments ?? 18;

  // Build the section in the ZY plane (chord along -Z, thickness along Y).
  const section: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    section.push(aerofoilPoint(t, chord, thickness, camber, true));
  }
  for (let i = segments - 1; i > 0; i -= 1) {
    const t = i / segments;
    section.push(aerofoilPoint(t, chord, thickness, camber, false));
  }

  const shape = new THREE.Shape(section);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: true,
    bevelThickness: thickness * 0.35,
    bevelSize: thickness * 0.35,
    bevelSegments: 3,
    curveSegments: 4,
  });
  // Extrude runs along +Z; rotate so the span runs along X and the chord along Z.
  geo.rotateY(Math.PI / 2);
  geo.translate(-span / 2, 0, 0);
  if (incidence !== 0) geo.rotateX(incidence);
  geo.computeVertexNormals();
  return geo;
}

/** One surface point of a cambered aerofoil at chord fraction t. */
function aerofoilPoint(t: number, chord: number, thickness: number, camber: number, upper: boolean): THREE.Vector2 {
  // NACA-style thickness distribution, scaled to the requested max thickness.
  const yt =
    5 *
    thickness *
    (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
  // Simple circular-arc camber line.
  const yc = camber * Math.sin(Math.PI * t);
  const y = upper ? yc + yt : yc - yt;
  // Chord runs from the leading edge at +Z back to the trailing edge.
  return new THREE.Vector2(chord * (0.5 - t), y);
}

/**
 * A wing endplate: a flat-ish plate with rounded corners and a swept profile,
 * built as an extruded rounded shape rather than a raw box.
 */
export function endplate(options: {
  length: number;
  height: number;
  thickness: number;
  /** How much the top-front corner is cut away, 0..1. */
  sweep?: number;
}): THREE.BufferGeometry {
  const { length, height, thickness } = options;
  const sweep = options.sweep ?? 0.35;
  const hl = length / 2;
  const hh = height / 2;
  const shape = new THREE.Shape();
  const r = Math.min(length, height) * 0.16;
  // Traced in the shape's local XY, where -X becomes the car's forward (+Z) after
  // the rotation below. The leading (forward) top corner is the one raked away,
  // so the plate's tall section sits at the trailing edge like a real endplate.
  shape.moveTo(-hl + r, -hh);
  shape.lineTo(hl - r, -hh);
  shape.quadraticCurveTo(hl, -hh, hl, -hh + r);
  shape.lineTo(hl, hh - r);
  shape.quadraticCurveTo(hl, hh, hl - r, hh);
  shape.lineTo(-hl + length * sweep * 0.6, hh);
  shape.quadraticCurveTo(-hl, hh - height * sweep * 0.35, -hl, hh - height * sweep);
  shape.lineTo(-hl, -hh + r);
  shape.quadraticCurveTo(-hl, -hh, -hl + r, -hh);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.3,
    bevelSize: thickness * 0.3,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // The shape was traced with length along X and height along Y, and extruded
  // along +Z. Rotating about Y stands the plate upright with its length running
  // fore/aft (Z) and its thickness across the car (X).
  geo.rotateY(-Math.PI / 2);
  geo.translate(thickness / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A slick racing tyre: a lathed profile with a crowned tread and bulged sidewalls
 * that fall in to the bead. The old wheels were plain cylinders, which showed a
 * hard polygonal edge in silhouette; a lathe gives a rounded shoulder that
 * catches light and reads as rubber.
 */
export function tyre(radius: number, width: number, radialSegments = 40): THREE.BufferGeometry {
  const hw = width / 2;
  const bead = radius * 0.62;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(bead, -hw),
    new THREE.Vector2(radius * 0.86, -hw * 1.02),
    new THREE.Vector2(radius * 0.97, -hw * 0.94),
    new THREE.Vector2(radius, -hw * 0.72),
    // Slight crown across the tread so the contact patch is not perfectly flat.
    new THREE.Vector2(radius * 1.004, 0),
    new THREE.Vector2(radius, hw * 0.72),
    new THREE.Vector2(radius * 0.97, hw * 0.94),
    new THREE.Vector2(radius * 0.86, hw * 1.02),
    new THREE.Vector2(bead, hw),
  ];
  const geo = new THREE.LatheGeometry(profile, radialSegments);
  // Lathe spins about +Y; the wheel spins about X.
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A forged rim: a lathed barrel plus spokes, sized to sit inside the tyre bead.
 * Returned as a group of geometries so the caller can assign rim/face materials.
 */
export function rimBarrel(radius: number, width: number, radialSegments = 32): THREE.BufferGeometry {
  const hw = width / 2;
  const bead = radius * 0.62;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(radius * 0.2, -hw * 0.86),
    new THREE.Vector2(bead * 0.92, -hw * 0.92),
    new THREE.Vector2(bead, -hw),
    new THREE.Vector2(bead, hw),
    new THREE.Vector2(bead * 0.92, hw * 0.92),
    new THREE.Vector2(radius * 0.2, hw * 0.86),
  ];
  const geo = new THREE.LatheGeometry(profile, radialSegments);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/** A single tapered spoke lying in the wheel plane, to be cloned around the hub. */
export function spoke(innerRadius: number, outerRadius: number, width: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = width / 2;
  shape.moveTo(innerRadius, -hw);
  shape.lineTo(outerRadius, -hw * 0.42);
  shape.lineTo(outerRadius, hw * 0.42);
  shape.lineTo(innerRadius, hw);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.25,
    bevelSize: thickness * 0.25,
    bevelSegments: 1,
    curveSegments: 1,
  });
  // Shape lies in XY (wheel plane); extrusion depth becomes axial thickness.
  geo.rotateY(Math.PI / 2);
  geo.translate(-thickness / 2, 0, 0);
  return geo;
}

/**
 * A brake disc with a drilled-look inner face and a carrier hat, lathed so the
 * edge reads round rather than faceted.
 */
export function brakeDisc(radius: number, thickness: number): THREE.BufferGeometry {
  const ht = thickness / 2;
  const inner = radius * 0.42;
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(inner, -ht * 2.2),
    new THREE.Vector2(inner * 1.05, -ht * 2.1),
    new THREE.Vector2(inner * 1.1, -ht),
    new THREE.Vector2(radius, -ht),
    new THREE.Vector2(radius, ht),
    new THREE.Vector2(inner * 1.1, ht),
    new THREE.Vector2(inner * 1.05, ht * 2.1),
    new THREE.Vector2(inner, ht * 2.2),
  ];
  const geo = new THREE.LatheGeometry(profile, 28);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A sidepod: a lofted body with a large radiator inlet mouth at the front,
 * undercut along the bottom and tapering into the coke-bottle at the rear.
 */
export function sidepod(options: {
  length: number;
  maxHalfWidth: number;
  height: number;
  /** Half-width at the tail as a fraction of max (the coke-bottle pinch). */
  tailPinch: number;
}): THREE.BufferGeometry {
  const { length, maxHalfWidth, height, tailPinch } = options;
  const back = -length / 2;
  const front = length / 2;
  const stations: Station[] = [
    { z: back, halfWidth: maxHalfWidth * tailPinch, y: 0.02, top: height * 0.34, bottom: height * 0.34, squareness: 3.2 },
    { z: back + length * 0.22, halfWidth: maxHalfWidth * (tailPinch + 0.28), y: 0.01, top: height * 0.42, bottom: height * 0.4, squareness: 3.4 },
    { z: back + length * 0.5, halfWidth: maxHalfWidth, y: 0, top: height * 0.5, bottom: height * 0.46, squareness: 3.6 },
    { z: back + length * 0.78, halfWidth: maxHalfWidth * 0.98, y: 0, top: height * 0.5, bottom: height * 0.48, squareness: 3.4 },
    // Squared-off inlet mouth at the leading edge.
    { z: front - length * 0.06, halfWidth: maxHalfWidth * 0.9, y: 0, top: height * 0.46, bottom: height * 0.44, squareness: 3.0 },
    { z: front, halfWidth: maxHalfWidth * 0.82, y: 0, top: height * 0.4, bottom: height * 0.38, squareness: 2.6 },
  ];
  return loftBody(stations, 24, true);
}

/** A helmet: a rounded shell with a flattened visor face and a chin bar. */
export function helmet(radius: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 24, 18);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    // Elongate front-to-back and flatten the sides slightly, like a real lid.
    v.z *= 1.14;
    v.x *= 0.94;
    // Flatten the crown a touch so it does not read as a beach ball.
    if (v.y > 0) v.y *= 0.94;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
