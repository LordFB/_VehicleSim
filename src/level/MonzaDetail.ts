import * as THREE from 'three';
import type {
  MonzaBrakingBoard,
  MonzaDetailBox,
  MonzaDetailPolyline,
  MonzaDetailSpec,
  MonzaPaintedRunoff,
  MonzaSurfaceArea,
  TreeSpeciesSpec,
} from './TrackDefinition';
import type { CenterlinePoint } from './MonzaTrack';
import { MONZA_OPEN_TOPO_PROFILE } from './MonzaElevation';
import type { MeshSurfaceLayerSpec, MeshSurfaceSpec } from '../sim/types';

type Sample = CenterlinePoint & { realS?: number; elevation: number };

export const MONZA_TREE_SPECIES: TreeSpeciesSpec[] = [
  { id: 'hornbeam', label: 'Carpinus betulus', weight: 3.2, minHeight: 5.5, maxHeight: 13, canopyColor: 0x426f34, highlightColor: 0x77a84f, trunkColor: 0x51422e, crownWidth: 0.78 },
  { id: 'horse-chestnut', label: 'Aesculus hippocastanum', weight: 1.8, minHeight: 7, maxHeight: 15, canopyColor: 0x355f2d, highlightColor: 0x6d9447, trunkColor: 0x514332, crownWidth: 0.92 },
  { id: 'plane', label: 'Platanus species', weight: 1.5, minHeight: 8, maxHeight: 17, canopyColor: 0x4f7f3a, highlightColor: 0x89a85f, trunkColor: 0x77705f, crownWidth: 0.86 },
  { id: 'wild-cherry', label: 'Prunus avium', weight: 1.0, minHeight: 5, maxHeight: 11, canopyColor: 0x4f7a3e, highlightColor: 0x9bb06a, trunkColor: 0x4b392d, crownWidth: 0.72 },
  { id: 'lime', label: 'Tilia cordata', weight: 1.4, minHeight: 6.5, maxHeight: 14, canopyColor: 0x487436, highlightColor: 0x91b461, trunkColor: 0x574531, crownWidth: 0.82 },
  { id: 'oak', label: 'Quercus species', weight: 1.7, minHeight: 7.5, maxHeight: 16, canopyColor: 0x365b2b, highlightColor: 0x728b45, trunkColor: 0x4d3a27, crownWidth: 0.95 },
];

const MONZA_REFERENCE_SURVEY: MonzaDetailSpec['referenceSurvey'] = {
  era: '2024-2026',
  reviewed: '2026-07-28',
  sources: [
    {
      kind: 'satellite',
      url: 'https://oversteer48.com/f1-circuits-from-space/',
      observation: 'Full-circuit aerial used for woodland clearings, historic oval context, paddock footprint, and relative stand clusters.',
    },
    {
      kind: 'ground-photo',
      url: 'https://www.invitalia.it/news-media/news/autodromo-nazionale-di-monza-al-la-gara-da-oltre-412-milioni-di-euro-la-riqualificazione',
      observation: 'Current pit straight has a long multi-storey pit building opposite roofed tiered grandstands.',
    },
    {
      kind: 'ground-photo',
      url: 'https://tickets.formula1.com/en/f1-3293-italy/8765-ascari',
      observation: 'Ascari has several tiered stands around the entry, centre, and exit with large gravel and green-painted runoff.',
    },
    {
      kind: 'ground-photo',
      url: 'https://coachdaveacademy.com/tutorials/autodromo-nazionale-monza-track-guide/',
      observation: 'Rettifilo photography confirms the straight-ahead escape lane, grass-separated chicane islands, kerbs, and open safety corridor.',
    },
    {
      kind: 'ground-photo',
      url: 'https://www.grandprix.com/news/monza-goes-back-to-gravel-run-off-areas.html',
      observation: 'The current Rettifilo and Roggia layouts retain straight-ahead escape routes while narrow gravel strips replace shortcut tarmac.',
    },
    {
      kind: 'official-map',
      url: 'https://www.monzanet.it/en/circuit/',
      observation: 'Official stand list confirms distinct clusters at the main straight, Rettifilo, Roggia, Ascari, and Curva Alboreto.',
    },
    {
      kind: 'official-map',
      url: 'https://aci.gov.it/comunicati-stampa/formula1-il-futuro-parte-da-monza/',
      observation: '2024 works rebuilt Mirabello access underpasses and added the Vedano-to-Parabolica access connection.',
    },
  ],
};

export function buildMonzaDetail(samples: Sample[]): MonzaDetailSpec {
  return {
    treeSpecies: MONZA_TREE_SPECIES,
    serviceRoads: buildServiceRoads(samples),
    fenceRuns: buildFenceRuns(samples),
    builtAreas: buildBuiltAreas(samples),
    surfaceAreas: buildCornerSurfaceAreas(samples),
    paintedRunoffs: buildPaintedRunoffs(samples),
    brakingBoards: buildBrakingBoards(samples),
    openTopo: MONZA_OPEN_TOPO_PROFILE,
    referenceSurvey: MONZA_REFERENCE_SURVEY,
  };
}

export function createMonzaDetailVisuals(detail: MonzaDetailSpec): {
  object: THREE.Object3D;
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
} {
  const group = new THREE.Group();
  group.name = 'monza-detail';
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  addServiceRoads(group, disposables, detail.serviceRoads);
  addCornerSurfaces(group, disposables, detail.surfaceAreas);
  addBuiltAreas(group, disposables, detail.builtAreas);
  addPaintedRunoffs(group, disposables, detail.paintedRunoffs);
  addFenceRuns(group, disposables, detail.fenceRuns);
  addBrakingBoards(group, disposables, detail.brakingBoards);

  return { object: group, disposables };
}

export function monzaCornerMeshSurface(areas: MonzaSurfaceArea[]): MeshSurfaceSpec {
  return {
    cellSize: 12,
    layers: areas.map(surfaceAreaLayer),
  };
}

function surfaceAreaLayer(area: MonzaSurfaceArea): MeshSurfaceLayerSpec {
  const contour = area.points.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  return {
    id: area.name,
    materialId: area.materialId,
    positions: area.points.flatMap(([x, z], index) => [x, area.elevations[index] + 0.025, z]),
    indices: faces.flatMap((face) => face),
    normals: area.points.flatMap(() => [0, 1, 0]),
  };
}

function buildCornerSurfaceAreas(samples: Sample[]): MonzaSurfaceArea[] {
  return [
    straightArea(samples, 'rettifilo-straight-escape', 600, 830, 5.8, 'asphalt_new', 0x26292a),
    straightArea(samples, 'roggia-braking-overrun', 1680, 1990, 5.2, 'asphalt_new', 0x292c2d),
    offsetBand(samples, 'lesmo-one-outer-gravel', 2080, 2370, 3.2, 10.5, 'gravel', 0xb2a58b),
    offsetBand(samples, 'lesmo-two-outer-gravel', 2440, 2680, 3.2, 11.5, 'gravel', 0xaea087),
    offsetBand(samples, 'ascari-entry-gravel', 3540, 3810, -3.2, -12.5, 'gravel', 0xb0a187),
    offsetBand(samples, 'ascari-exit-painted-runoff', 3780, 4130, 3.0, 7.2, 'painted_line', 0x21824b),
    offsetBand(samples, 'alboreto-outer-asphalt', 4750, 5520, 3.0, 14.5, 'asphalt_new', 0x2b2e2f),
  ];
}

function straightArea(
  samples: Sample[],
  name: string,
  fromS: number,
  toS: number,
  width: number,
  materialId: MonzaSurfaceArea['materialId'],
  color: number,
): MonzaSurfaceArea {
  const start = at(samples, fromS);
  const length = (toS - fromS) * 0.5;
  const end: [number, number] = [
    start.pos[0] + start.tangent[0] * length,
    start.pos[1] + start.tangent[1] * length,
  ];
  const half = width * 0.5;
  return makeSurfaceArea(samples, name, materialId, color, [
    [start.pos[0] + start.left[0] * half, start.pos[1] + start.left[1] * half],
    [start.pos[0] - start.left[0] * half, start.pos[1] - start.left[1] * half],
    [end[0] - start.left[0] * half, end[1] - start.left[1] * half],
    [end[0] + start.left[0] * half, end[1] + start.left[1] * half],
  ]);
}

function offsetBand(
  samples: Sample[],
  name: string,
  fromS: number,
  toS: number,
  innerOffset: number,
  outerOffset: number,
  materialId: MonzaSurfaceArea['materialId'],
  color: number,
): MonzaSurfaceArea {
  const inner: Array<[number, number]> = [];
  const outer: Array<[number, number]> = [];
  const step = 24;
  for (let s = fromS; s <= toS; s += step) {
    const p = at(samples, s);
    inner.push([p.pos[0] + p.left[0] * innerOffset, p.pos[1] + p.left[1] * innerOffset]);
    outer.push([p.pos[0] + p.left[0] * outerOffset, p.pos[1] + p.left[1] * outerOffset]);
  }
  const end = at(samples, toS);
  inner.push([end.pos[0] + end.left[0] * innerOffset, end.pos[1] + end.left[1] * innerOffset]);
  outer.push([end.pos[0] + end.left[0] * outerOffset, end.pos[1] + end.left[1] * outerOffset]);
  return makeSurfaceArea(samples, name, materialId, color, [...inner, ...outer.reverse()]);
}

function makeSurfaceArea(
  samples: Sample[],
  name: string,
  materialId: MonzaSurfaceArea['materialId'],
  color: number,
  points: Array<[number, number]>,
): MonzaSurfaceArea {
  return {
    name,
    materialId,
    color,
    points,
    elevations: points.map(([x, z]) => nearestElevation(samples, x, z)),
  };
}

function nearestElevation(samples: Sample[], x: number, z: number): number {
  let best = samples[0];
  let bestDistance = Infinity;
  for (const sample of samples) {
    const distance = (sample.pos[0] - x) ** 2 + (sample.pos[1] - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sample;
    }
  }
  return best.elevation;
}

function buildServiceRoads(samples: Sample[]): MonzaDetailPolyline[] {
  return [
    offsetRoad(samples, 'pit-lane-service-road', 20, 520, -16, 5.2),
    offsetRoad(samples, 'rettifilo-outer-access', 80, 760, 25, 4.5),
    offsetRoad(samples, 'roggia-serraglio-access', 1380, 2500, -18, 3.8),
    offsetRoad(samples, 'lesmo-woodland-path', 2400, 3600, 20, 3.4),
    offsetRoad(samples, 'ascari-back-service', 3650, 4550, -18, 4.2),
    offsetRoad(samples, 'parabolica-emergency-road', 4800, 5600, 22, 4.5),
  ];
}

function buildFenceRuns(samples: Sample[]): MonzaDetailPolyline[] {
  const runs: MonzaDetailPolyline[] = [];
  const ranges: Array<[string, number, number, number]> = [
    ['main-straight-left-fence', 0, 780, 10],
    ['main-straight-right-fence', 0, 780, -10],
    ['curva-grande-fence', 760, 1420, 12],
    ['roggia-serraglio-fence', 1320, 3120, -11],
    ['lesmo-fence', 2100, 3220, 11],
    ['ascari-fence', 3650, 4480, -11],
    ['parabolica-fence', 4740, 5740, 12],
  ];
  for (const [name, from, to, offset] of ranges) runs.push(offsetRoad(samples, name, from, to, offset, 0.16));
  return runs;
}

function buildBuiltAreas(samples: Sample[]): MonzaDetailBox[] {
  return [
    // Main straight: long pit/race-control frontage, paddock massing behind it, and
    // several separate public stands on the opposite side.
    boxAt(samples, 'pit-building-south', 95, -25, [9, 4.5, 62], 0xa7adb0, 'building'),
    boxAt(samples, 'pit-building-central', 230, -25, [10, 5.2, 72], 0x9ba0a3, 'building'),
    boxAt(samples, 'race-control-building', 365, -25, [10, 6.2, 52], 0x858d92, 'building'),
    boxAt(samples, 'paddock-hospitality-south', 155, -43, [13, 5.5, 60], 0xd8d8d2, 'building'),
    boxAt(samples, 'paddock-hospitality-north', 330, -43, [14, 5.8, 66], 0xc9cbc8, 'building'),
    boxAt(samples, 'central-grandstand', 135, 34, [13, 5.8, 72], 0x9badaf, 'grandstand'),
    boxAt(samples, 'finish-line-grandstand', 295, 34, [12, 5.2, 62], 0x9aa5a8, 'grandstand'),
    boxAt(samples, 'high-speed-grandstand', 455, 34, [12, 5.4, 72], 0x9aa5a8, 'grandstand'),
    raisedBoxAt(samples, 'central-grandstand-canopy', 135, 34, [15, 0.4, 74], 5.8, 0xf1f0e9, 'canopy'),
    raisedBoxAt(samples, 'pit-building-canopy', 230, -25, [12, 0.35, 74], 5.2, 0xe8e8e4, 'canopy'),
    // The official spectator plan and aerials show paired clusters at both chicanes.
    boxAt(samples, 'rettifilo-external-grandstand', 690, 34, [15, 5.2, 46], 0xa5adb0, 'grandstand'),
    boxAt(samples, 'rettifilo-infield-grandstand', 785, -30, [12, 4.5, 36], 0x9fa7aa, 'grandstand'),
    raisedBoxAt(samples, 'rettifilo-external-canopy', 690, 34, [17, 0.35, 48], 5.2, 0xf0efe7, 'canopy'),
    boxAt(samples, 'second-variant-grandstand', 1435, 31, [12, 4.2, 34], 0xa6adae, 'grandstand'),
    boxAt(samples, 'roggia-grandstand', 1550, -34, [14, 5.0, 48], 0x9da7a9, 'grandstand'),
    boxAt(samples, 'lesmo-marshals', 2750, 27, [7, 3.4, 20], 0xb8b1a3, 'building'),

    // Ascari is a long spectator complex, not a single stand.
    boxAt(samples, 'ascari-one-grandstand', 3920, 32, [13, 4.6, 42], 0xa5acae, 'grandstand'),
    boxAt(samples, 'ascari-central-grandstand', 4070, -34, [15, 5.2, 54], 0x9da6a8, 'grandstand'),
    boxAt(samples, 'ascari-exit-grandstand', 4260, -34, [15, 5.0, 58], 0xa4acae, 'grandstand'),
    raisedBoxAt(samples, 'ascari-central-canopy', 4070, -34, [17, 0.35, 56], 5.2, 0xf0efe8, 'canopy'),

    // Alboreto/Parabolica has stands on both sides of the long right-hander and exit.
    boxAt(samples, 'alboreto-side-grandstand', 4930, 35, [14, 4.8, 48], 0xa5adaf, 'grandstand'),
    boxAt(samples, 'alboreto-infield-grandstand', 5140, -34, [15, 5.0, 64], 0x9ca6a8, 'grandstand'),
    boxAt(samples, 'vedano-grandstand', 5320, 36, [15, 5.2, 72], 0xa4acae, 'grandstand'),
    raisedBoxAt(samples, 'vedano-grandstand-canopy', 5320, 36, [17, 0.35, 74], 5.2, 0xf0efe8, 'canopy'),

    // Low portal massing records the 2024 Mirabello rebuild and new Vedano access.
    boxAt(samples, 'mirabello-underpass-portal', 4610, -11, [7, 2.2, 3.4], 0x6e7475, 'portal'),
    boxAt(samples, 'vedano-underpass-portal', 5230, 15, [8, 2.3, 3.8], 0x707677, 'portal'),
  ];
}

function raisedBoxAt(
  samples: Sample[],
  name: string,
  station: number,
  offset: number,
  size: [number, number, number],
  baseHeight: number,
  color: number,
  profile: MonzaDetailBox['profile'],
): MonzaDetailBox {
  const box = boxAt(samples, name, station, offset, size, color, profile);
  box.center[1] += baseHeight;
  return box;
}

function buildPaintedRunoffs(samples: Sample[]): MonzaPaintedRunoff[] {
  const specs: Array<[string, number, number, [number, number]]> = [
    ['roggia-entry', 1450, 8, [15, 9]],
    ['roggia-exit', 1600, -9, [15, 9]],
    ['ascari-left', 3980, -10, [18, 10]],
    ['ascari-exit', 4250, 10, [22, 9]],
    ['parabolica-exit', 5320, 11, [28, 9]],
  ];
  const out: MonzaPaintedRunoff[] = [];
  for (const [name, s, offset, size] of specs) {
    const p = at(samples, s);
    const cx = p.pos[0] + p.left[0] * offset;
    const cz = p.pos[1] + p.left[1] * offset;
    const yawRad = Math.atan2(p.tangent[0], p.tangent[1]);
    out.push({ name: `${name}-green`, center: [cx, cz], size, yawRad, color: 'green' });
    out.push({ name: `${name}-white`, center: [cx - p.left[0] * 1.2, cz - p.left[1] * 1.2], size: [size[0] * 0.18, size[1]], yawRad, color: 'white' });
    out.push({ name: `${name}-red`, center: [cx - p.left[0] * 2.1, cz - p.left[1] * 2.1], size: [size[0] * 0.14, size[1]], yawRad, color: 'red' });
  }
  return out;
}

function buildBrakingBoards(samples: Sample[]): MonzaBrakingBoard[] {
  const zones = [610, 1380, 3860, 4800];
  const labels = [150, 100, 50];
  const out: MonzaBrakingBoard[] = [];
  for (const zone of zones) {
    labels.forEach((label, i) => {
      for (const side of [-1, 1] as const) {
        const p = at(samples, zone - i * 35);
        out.push({
          label: `${label}`,
          position: [
            p.pos[0] + p.left[0] * side * 7.5,
            p.elevation + 0.9,
            p.pos[1] + p.left[1] * side * 7.5,
          ],
          yawRad: Math.atan2(p.tangent[0], p.tangent[1]) + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5),
        });
      }
    });
  }
  return out;
}

function offsetRoad(samples: Sample[], name: string, fromS: number, toS: number, offset: number, width: number): MonzaDetailPolyline {
  const points: Array<[number, number]> = [];
  const step = 45;
  for (let s = fromS; s <= toS; s += step) {
    const p = at(samples, s);
    points.push([p.pos[0] + p.left[0] * offset, p.pos[1] + p.left[1] * offset]);
  }
  const end = at(samples, toS);
  points.push([end.pos[0] + end.left[0] * offset, end.pos[1] + end.left[1] * offset]);
  return { name, points, width };
}

function boxAt(
  samples: Sample[],
  name: string,
  station: number,
  offset: number,
  size: [number, number, number],
  color: number,
  profile: MonzaDetailBox['profile'],
): MonzaDetailBox {
  const p = at(samples, station);
  return {
    name,
    center: [p.pos[0] + p.left[0] * offset, p.elevation + size[1] * 0.5, p.pos[1] + p.left[1] * offset],
    size,
    yawRad: Math.atan2(p.tangent[0], p.tangent[1]),
    color,
    profile,
  };
}

function at(samples: Sample[], realS: number): Sample {
  let best = samples[0];
  let bestD = Infinity;
  for (const sample of samples) {
    const d = Math.abs((sample.realS ?? sample.s) - realS);
    if (d < bestD) { best = sample; bestD = d; }
  }
  return best;
}

function addServiceRoads(group: THREE.Group, disposables: Array<THREE.BufferGeometry | THREE.Material>, roads: MonzaDetailPolyline[]): void {
  const segments = roads.flatMap((road) => polySegments(road.points, road.width ?? 4));
  addSegmentInstances(group, disposables, 'monza-detail-service-roads', segments, 0.025, 0x5d6060, 0.012);
}

function addCornerSurfaces(
  group: THREE.Group,
  disposables: Array<THREE.BufferGeometry | THREE.Material>,
  areas: MonzaSurfaceArea[],
): void {
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = 'monza-detail-corner-surfaces';
  for (const area of areas) {
    const layer = surfaceAreaLayer(area);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(layer.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(layer.normals!, 3));
    geometry.setIndex(layer.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: area.color,
      roughness: area.materialId === 'gravel' ? 1 : 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `monza-surface-${area.name}`;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    surfaceGroup.add(mesh);
    disposables.push(geometry, material);
  }
  group.add(surfaceGroup);
}

function addFenceRuns(group: THREE.Group, disposables: Array<THREE.BufferGeometry | THREE.Material>, runs: MonzaDetailPolyline[]): void {
  const postPositions: Array<[number, number]> = [];
  const railSegments: Array<{ center: [number, number]; length: number; yawRad: number; width: number }> = [];
  for (const run of runs) {
    railSegments.push(...polySegments(run.points, 0.06));
    for (let i = 1; i < run.points.length; i += 1) {
      const a = run.points[i - 1], b = run.points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.floor(len / 6));
      for (let k = 0; k <= count; k += 1) {
        const t = k / count;
        postPositions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  addPointInstances(group, disposables, 'monza-detail-fence-posts', postPositions, [0.08, 1.7, 0.08], 0xc7ced1, 0.85);
  addSegmentInstances(group, disposables, 'monza-detail-fence-rails', railSegments, 0.06, 0xaab1b6, 0.95);
}

function addBuiltAreas(group: THREE.Group, disposables: Array<THREE.BufferGeometry | THREE.Material>, boxes: MonzaDetailBox[]): void {
  const profiles: MonzaDetailBox['profile'][] = ['building', 'grandstand', 'canopy', 'portal'];
  const names: Record<MonzaDetailBox['profile'], string> = {
    building: 'monza-detail-built-areas',
    grandstand: 'monza-detail-grandstands',
    canopy: 'monza-detail-canopies',
    portal: 'monza-detail-portals',
  };
  for (const profile of profiles) {
    const entries = boxes.filter((box) => box.profile === profile);
    if (entries.length === 0) continue;
    const geo = profile === 'grandstand' ? grandstandGeometry() : new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: profile === 'canopy' ? 0.62 : 0.85, metalness: 0.05 });
    disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, entries.length);
    mesh.name = names[profile];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    entries.forEach((box, i) => {
      q.setFromAxisAngle(UP, box.yawRad);
      m.compose(new THREE.Vector3(...box.center), q, new THREE.Vector3(...box.size));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(box.color ?? 0xb4b1aa));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    finalizeInstanced(mesh);
    group.add(mesh);
  }
}

function grandstandGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0.5, 0.5);
  shape.lineTo(-0.5, -0.1);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.translate(0, 0, -0.5);
  geometry.computeVertexNormals();
  return geometry;
}

function addPaintedRunoffs(group: THREE.Group, disposables: Array<THREE.BufferGeometry | THREE.Material>, runoffs: MonzaPaintedRunoff[]): void {
  const colors = {
    green: 0x15924d,
    white: 0xf2f0e6,
    red: 0xc93a32,
  };
  for (const color of ['green', 'white', 'red'] as const) {
    const entries = runoffs.filter((r) => r.color === color);
    const segments = entries.map((r) => ({ center: r.center, length: r.size[1], yawRad: r.yawRad, width: r.size[0] }));
    addSegmentInstances(group, disposables, `monza-detail-runoff-${color}`, segments, 0.018, colors[color], 0.03);
  }
}

function addBrakingBoards(group: THREE.Group, disposables: Array<THREE.BufferGeometry | THREE.Material>, boards: MonzaBrakingBoard[]): void {
  const geo = new THREE.BoxGeometry(0.8, 0.55, 0.05);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.45, metalness: 0.02 });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, boards.length);
  mesh.name = 'monza-detail-braking-boards';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  boards.forEach((board, i) => {
    q.setFromAxisAngle(UP, board.yawRad);
    m.compose(new THREE.Vector3(...board.position), q, scale);
    mesh.setMatrixAt(i, m);
  });
  finalizeInstanced(mesh);
  group.add(mesh);
}

function addSegmentInstances(
  group: THREE.Group,
  disposables: Array<THREE.BufferGeometry | THREE.Material>,
  name: string,
  segments: Array<{ center: [number, number]; length: number; yawRad: number; width: number }>,
  height: number,
  color: number,
  y: number,
): void {
  if (segments.length === 0) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, segments.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  segments.forEach((seg, i) => {
    q.setFromAxisAngle(UP, seg.yawRad);
    m.compose(new THREE.Vector3(seg.center[0], y, seg.center[1]), q, new THREE.Vector3(seg.width, height, seg.length));
    mesh.setMatrixAt(i, m);
  });
  finalizeInstanced(mesh);
  group.add(mesh);
}

function addPointInstances(
  group: THREE.Group,
  disposables: Array<THREE.BufferGeometry | THREE.Material>,
  name: string,
  points: Array<[number, number]>,
  size: [number, number, number],
  color: number,
  y: number,
): void {
  if (points.length === 0) return;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1 });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  mesh.name = name;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3(...size);
  points.forEach((p, i) => {
    m.compose(new THREE.Vector3(p[0], y, p[1]), q, scale);
    mesh.setMatrixAt(i, m);
  });
  finalizeInstanced(mesh);
  group.add(mesh);
}

function polySegments(points: Array<[number, number]>, width: number): Array<{ center: [number, number]; length: number; yawRad: number; width: number }> {
  const out: Array<{ center: [number, number]; length: number; yawRad: number; width: number }> = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (length <= 1e-4) continue;
    out.push({ center: [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5], length, yawRad: Math.atan2(dx, dz), width });
  }
  return out;
}

function finalizeInstanced(mesh: THREE.InstancedMesh): void {
  mesh.frustumCulled = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

const UP = new THREE.Vector3(0, 1, 0);
