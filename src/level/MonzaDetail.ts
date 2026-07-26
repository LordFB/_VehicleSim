import * as THREE from 'three';
import type {
  MonzaBrakingBoard,
  MonzaDetailBox,
  MonzaDetailPolyline,
  MonzaDetailSpec,
  MonzaPaintedRunoff,
  TreeSpeciesSpec,
} from './TrackDefinition';
import type { CenterlinePoint } from './MonzaTrack';
import { MONZA_OPEN_TOPO_PROFILE } from './MonzaElevation';

type Sample = CenterlinePoint & { realS?: number; elevation: number };

export const MONZA_TREE_SPECIES: TreeSpeciesSpec[] = [
  { id: 'hornbeam', label: 'Carpinus betulus', weight: 3.2, minHeight: 5.5, maxHeight: 13, canopyColor: 0x426f34, highlightColor: 0x77a84f, trunkColor: 0x51422e, crownWidth: 0.78 },
  { id: 'horse-chestnut', label: 'Aesculus hippocastanum', weight: 1.8, minHeight: 7, maxHeight: 15, canopyColor: 0x355f2d, highlightColor: 0x6d9447, trunkColor: 0x514332, crownWidth: 0.92 },
  { id: 'plane', label: 'Platanus species', weight: 1.5, minHeight: 8, maxHeight: 17, canopyColor: 0x4f7f3a, highlightColor: 0x89a85f, trunkColor: 0x77705f, crownWidth: 0.86 },
  { id: 'wild-cherry', label: 'Prunus avium', weight: 1.0, minHeight: 5, maxHeight: 11, canopyColor: 0x4f7a3e, highlightColor: 0x9bb06a, trunkColor: 0x4b392d, crownWidth: 0.72 },
  { id: 'lime', label: 'Tilia cordata', weight: 1.4, minHeight: 6.5, maxHeight: 14, canopyColor: 0x487436, highlightColor: 0x91b461, trunkColor: 0x574531, crownWidth: 0.82 },
  { id: 'oak', label: 'Quercus species', weight: 1.7, minHeight: 7.5, maxHeight: 16, canopyColor: 0x365b2b, highlightColor: 0x728b45, trunkColor: 0x4d3a27, crownWidth: 0.95 },
];

export function buildMonzaDetail(samples: Sample[]): MonzaDetailSpec {
  return {
    treeSpecies: MONZA_TREE_SPECIES,
    serviceRoads: buildServiceRoads(samples),
    fenceRuns: buildFenceRuns(samples),
    builtAreas: buildBuiltAreas(samples),
    paintedRunoffs: buildPaintedRunoffs(samples),
    brakingBoards: buildBrakingBoards(samples),
    openTopo: MONZA_OPEN_TOPO_PROFILE,
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
  addBuiltAreas(group, disposables, detail.builtAreas);
  addPaintedRunoffs(group, disposables, detail.paintedRunoffs);
  addFenceRuns(group, disposables, detail.fenceRuns);
  addBrakingBoards(group, disposables, detail.brakingBoards);

  return { object: group, disposables };
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
    boxAt(samples, 'pit-building', 170, -26, [9, 4.2, 88], 0x9ba0a3),
    boxAt(samples, 'main-grandstand', 320, 34, [11, 5.8, 120], 0xb7b3aa),
    bridgeAt(samples, 'rettifilo-overhead-bridge', 585, [36, 1.4, 5.5], 0xb8b4aa),
    boxAt(samples, 'first-chicane-stand', 760, 32, [13, 4.2, 38], 0xa9aaa4),
    boxAt(samples, 'roggia-stand', 1540, -34, [12, 4.2, 42], 0xaaa79c),
    boxAt(samples, 'lesmo-marshals', 2750, 27, [7, 3.4, 20], 0xb8b1a3),
    boxAt(samples, 'ascari-stand', 4070, -34, [14, 4.8, 52], 0xb0ada5),
    boxAt(samples, 'parabolica-stand', 5140, 36, [15, 4.5, 72], 0xb6b2a8),
  ];
}

function bridgeAt(samples: Sample[], name: string, station: number, size: [number, number, number], color: number): MonzaDetailBox {
  const p = at(samples, station);
  return {
    name,
    center: [p.pos[0], p.elevation + 5.8, p.pos[1]],
    size,
    yawRad: Math.atan2(p.tangent[0], p.tangent[1]) + Math.PI * 0.5,
    color,
  };
}

function buildPaintedRunoffs(samples: Sample[]): MonzaPaintedRunoff[] {
  const specs: Array<[string, number, number, [number, number]]> = [
    ['rettifilo-entry', 680, -8, [18, 10]],
    ['rettifilo-exit', 790, 9, [16, 8]],
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

function boxAt(samples: Sample[], name: string, station: number, offset: number, size: [number, number, number], color: number): MonzaDetailBox {
  const p = at(samples, station);
  return {
    name,
    center: [p.pos[0] + p.left[0] * offset, p.elevation + size[1] * 0.5, p.pos[1] + p.left[1] * offset],
    size,
    yawRad: Math.atan2(p.tangent[0], p.tangent[1]),
    color,
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
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xb4b1aa, roughness: 0.85, metalness: 0.05 });
  disposables.push(geo, mat);
  const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
  mesh.name = 'monza-detail-built-areas';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  boxes.forEach((box, i) => {
    q.setFromAxisAngle(UP, box.yawRad);
    m.compose(new THREE.Vector3(...box.center), q, new THREE.Vector3(...box.size));
    mesh.setMatrixAt(i, m);
  });
  finalizeInstanced(mesh);
  group.add(mesh);
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
