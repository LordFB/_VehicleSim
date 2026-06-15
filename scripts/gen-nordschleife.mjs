import { readFileSync, writeFileSync } from 'node:fs';

const RAW = JSON.parse(readFileSync(new URL('_nordschleife/osm-ways.json', import.meta.url), 'utf8'));

// Clockwise Nordschleife-only loop, starting from the short T13/Hohenrain connector.
// Source: OpenStreetMap highway=raceway ways fetched from Overpass, ODbL.
const WAY_IDS = [
  41395668, 41395670, 41395673, 1009142894, 1009142895,
  799394496, 799394497, 41395681, 41395684, 799394498, 799394499,
  799394500, 799394501, 799394502, 799394503, 799394504, 799394505,
  799394506, 799394507, 683061813, 683061814, 683006908, 245166664,
  799394508, 799394509, 683061804, 799394510, 799394511, 799394512,
  799394513, 414785755, 414785756, 799394515, 799394514, 799394516,
  799394517, 799394518, 799394519, 799394520, 799394521, 799394522,
  799394523, 799394524, 41395652, 683303211, 683303210, 683303209,
  683303208, 41792406, 799394494, 799394495,
];

const SCALE = 1 / 2;
const TARGET_REAL_LENGTH = 20832;
const RESAMPLE_REAL_STEP = 5;
const TRACK_HALF_WIDTH_REAL = 5.5;
const SHOULDER_WIDTH_REAL = 2.4;
const R = 6378137;
const d2r = Math.PI / 180;

const wayById = new Map(RAW.elements.map((way) => [way.id, way]));
const coords = [];
for (const id of WAY_IDS) {
  const way = wayById.get(id);
  if (!way) throw new Error(`Missing OSM way ${id}`);
  const pts = way.geometry.map((p) => [p.lon, p.lat, way.tags?.name ?? '']);
  if (coords.length === 0) {
    coords.push(...pts);
    continue;
  }
  const last = coords[coords.length - 1];
  const first = pts[0];
  const end = pts[pts.length - 1];
  const dFirst = haversine(last[1], last[0], first[1], first[0]);
  const dEnd = haversine(last[1], last[0], end[1], end[0]);
  const ordered = dEnd < dFirst ? pts.slice().reverse() : pts;
  coords.push(...ordered.slice(nearSame(last, ordered[0]) ? 1 : 0));
}
coords.push(coords[0]);

const lat0 = coords.reduce((a, p) => a + p[1], 0) / coords.length;
const lon0 = coords.reduce((a, p) => a + p[0], 0) / coords.length;
const metres = coords.map(([lon, lat, name]) => [
  (lon - lon0) * d2r * R * Math.cos(lat0 * d2r),
  (lat - lat0) * d2r * R,
  name,
]);

// Move start to origin and rotate the first connector to +Z like the Monza pipeline.
const p0 = metres[0];
const p1 = metres[8] ?? metres[1];
const ang = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
const c = Math.cos(-ang), s = Math.sin(-ang);
let line = metres.map(([x, z, name]) => {
  const dx = x - p0[0], dz = z - p0[1];
  return [(dx * c - dz * s), (dx * s + dz * c), name];
});

const originalLength = polylineLength(line);
const lengthScale = TARGET_REAL_LENGTH / originalLength;
line = line.map(([x, z, name]) => [x * lengthScale, z * lengthScale, name]);

const resampled = resample(line, RESAMPLE_REAL_STEP);
const total = polylineLength(resampled);
const samples = [];
let acc = 0;
for (let i = 0; i < resampled.length; i++) {
  if (i > 0) acc += dist(resampled[i - 1], resampled[i]);
  const prev = resampled[(i - 1 + resampled.length) % resampled.length];
  const cur = resampled[i];
  const next = resampled[(i + 1) % resampled.length];
  const tangent = normalize([next[0] - prev[0], next[1] - prev[1]]);
  const left = [-tangent[1], tangent[0]];
  const h0 = Math.atan2(cur[0] - prev[0], cur[1] - prev[1]);
  const h1 = Math.atan2(next[0] - cur[0], next[1] - cur[1]);
  const curvature = -wrapPi(h1 - h0) / Math.max(1, dist(prev, cur));
  const t = acc / total;
  const nextT = Math.min(1, (acc + RESAMPLE_REAL_STEP) / total);
  const prevT = Math.max(0, (acc - RESAMPLE_REAL_STEP) / total);
  const elev = elevationReal(t);
  const slope = (elevationReal(nextT) - elevationReal(prevT)) / Math.max(1, (nextT - prevT) * total);
  const camber = camberRad(t, curvature);
  const normal = normalize3([
    -tangent[0] * slope - left[0] * Math.tan(camber),
    1,
    -tangent[1] * slope - left[1] * Math.tan(camber),
  ]);
  samples.push({
    pos: [round(cur[0] * SCALE), round(cur[1] * SCALE)],
    tangent: [round(tangent[0]), round(tangent[1])],
    left: [round(left[0]), round(left[1])],
    normal: [round(normal[0]), round(normal[1]), round(normal[2])],
    curvature: round(curvature / SCALE),
    s: round(acc * SCALE),
    realS: round(acc),
    elevation: round(elev * SCALE),
    camber: round(camber),
    sector: sectorName(t),
  });
}
samples.push({ ...samples[0], s: round(total * SCALE), realS: round(total) });

const data = {
  attribution: {
    geometry: 'OpenStreetMap contributors, ODbL. Fetched from Overpass API on 2026-06-14.',
    elevation: 'Procedural macro profile based on public Nordschleife elevation characteristics; not laser-scan data.',
  },
  metadata: {
    realLengthMeters: round(total),
    scale: SCALE,
    scaledTrackHalfWidth: round(TRACK_HALF_WIDTH_REAL * SCALE),
    scaledShoulderWidth: round(SHOULDER_WIDTH_REAL * SCALE),
  },
  samples,
  landmarks: [
    ['Hatzenbach', 0.06],
    ['Flugplatz', 0.16],
    ['Schwedenkreuz', 0.21],
    ['Aremberg', 0.24],
    ['Fuchsrohre', 0.29],
    ['Adenauer Forst', 0.35],
    ['Breidscheid', 0.45],
    ['Bergwerk', 0.50],
    ['Kesselchen', 0.58],
    ['Karussell', 0.66],
    ['Hohe Acht', 0.70],
    ['Brunnchen', 0.79],
    ['Pflanzgarten', 0.85],
    ['Schwalbenschwanz', 0.91],
    ['Galgenkopf', 0.95],
    ['Dottinger Hohe', 0.98],
  ].map(([name, t]) => ({ name, realS: round(Number(t) * total) })),
};

writeFileSync(new URL('../src/level/nordschleifeData.json', import.meta.url), `${JSON.stringify(data)}\n`);
console.log(`Nordschleife samples=${samples.length} realLength=${total.toFixed(0)}m scaled=${(total * SCALE).toFixed(0)}m`);

function elevationReal(t) {
  // Smooth profile with known character: low Breidscheid valley, climb to Hohe Acht,
  // fast drops and crests around Fuchsrohre, Flugplatz, Pflanzgarten.
  const anchors = [
    [0.00, 610], [0.10, 600], [0.18, 625], [0.25, 565], [0.31, 445],
    [0.39, 380], [0.46, 330], [0.53, 410], [0.61, 540], [0.70, 625],
    [0.78, 585], [0.86, 520], [0.93, 565], [1.00, 610],
  ];
  let i = 0;
  while (i < anchors.length - 2 && t > anchors[i + 1][0]) i++;
  const [aT, aE] = anchors[i];
  const [bT, bE] = anchors[i + 1];
  const u = smoothstep((t - aT) / (bT - aT));
  const bumps =
    crest(t, 0.17, 0.018, 8) -
    crest(t, 0.30, 0.020, 18) +
    crest(t, 0.66, 0.022, 12) +
    crest(t, 0.84, 0.018, 10) -
    crest(t, 0.87, 0.014, 8);
  return aE + (bE - aE) * u + bumps;
}

function camberRad(t, curvature) {
  const base = Math.max(-0.08, Math.min(0.08, curvature * 0.7));
  const karussell = t > 0.64 && t < 0.675 ? -0.24 : 0;
  const mini = t > 0.905 && t < 0.925 ? -0.14 : 0;
  return base + karussell + mini + Math.sin(t * Math.PI * 22) * 0.018;
}

function sectorName(t) {
  const names = [
    [0.04, 'T13'], [0.12, 'Hatzenbach'], [0.18, 'Flugplatz'], [0.24, 'Aremberg'],
    [0.33, 'Fuchsrohre'], [0.42, 'Adenauer Forst'], [0.50, 'Breidscheid'],
    [0.58, 'Kesselchen'], [0.68, 'Karussell'], [0.76, 'Hohe Acht'],
    [0.84, 'Brunnchen'], [0.91, 'Pflanzgarten'], [0.96, 'Schwalbenschwanz'], [1, 'Dottinger Hohe'],
  ];
  return names.find(([limit]) => t <= limit)?.[1] ?? 'Nordschleife';
}

function resample(points, step) {
  const out = [[points[0][0], points[0][1], points[0][2]]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    let d = carry;
    while (d + step <= len) {
      d += step;
      const u = d / len;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, b[2]]);
    }
    carry = d + step - len;
  }
  return out;
}

function haversine(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * d2r) / 2) ** 2 +
    Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(((lon2 - lon1) * d2r) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function polylineLength(points) { let n = 0; for (let i = 1; i < points.length; i++) n += dist(points[i - 1], points[i]); return n; }
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function normalize(v) { const n = Math.hypot(v[0], v[1]) || 1; return [v[0] / n, v[1] / n]; }
function normalize3(v) { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; }
function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function smoothstep(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
function crest(t, center, width, height) { const u = (t - center) / width; return Math.exp(-u * u) * height; }
function nearSame(a, b) { return haversine(a[1], a[0], b[1], b[0]) < 0.3; }
function round(n) { return +n.toFixed(4); }
