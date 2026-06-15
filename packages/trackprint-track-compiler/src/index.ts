import {
  add,
  collectStationCuts,
  createSegment,
  evaluateStation,
  evaluateStationValueCurve,
  evaluateTrackWidth,
  findActiveCurb,
  findActiveRunoff,
  findSectorAtStation,
  isStationInInterval,
  leftNormal,
  nearestStation,
  normalize,
  processStationCuts,
  repairTrackContinuity,
  resolveStructureSpans,
  scale,
  stationValueDerivative,
  subtract,
  type ProcessedStationCut,
  type CurbProfileType,
  type CurbInterval,
  type RunoffInterval,
  type StationLookup,
  type StructureSpan,
  type TrackDocument,
  type TrackSide,
  type Vector2,
} from '@trackprint/track-core';

export interface TrackCrossSection {
  readonly station: number;
  readonly center: Vector2;
  readonly centerHeight: number;
  readonly tangent: Vector2;
  readonly normal: Vector2;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly leftEdge: Vector2;
  readonly rightEdge: Vector2;
  readonly leftHeight: number;
  readonly rightHeight: number;
  readonly banking: number;
  readonly slope: number;
  /**
   * Signed curvature of the centerline at this row (1/m). Positive curves
   * toward the left normal, negative toward the right. The reciprocal is the
   * local radius of curvature; lateral offsets larger than that radius on the
   * concave side fold the offset surface, which is what produces overlapping
   * seams in tight corners.
   */
  readonly curvature: number;
  readonly cut: ProcessedStationCut;
  readonly segmentId: string;
  readonly activeIntervalIds: readonly string[];
}

export interface AsphaltMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly materialGroups: readonly AsphaltMaterialGroup[];
  readonly rowMetadata: readonly AsphaltRowMetadata[];
  readonly rowCount: number;
}

export interface SurfaceBandMeshData extends AsphaltMeshData {
  readonly intervalId: string;
  readonly side: TrackSide;
  readonly bandType: 'curb' | 'runoff';
  readonly columnCount: number;
}

export interface StructureMeshData extends AsphaltMeshData {
  readonly structureId: string;
  readonly kind: 'tunnel' | 'bridge';
  readonly bandType: 'tunnelBore' | 'bridgeDeck';
  readonly columnCount: number;
  /**
   * Underside Y of a bridge deck per row (world meters), keyed to `rowMetadata`
   * by index. Pillars are dropped from these points to the terrain. Empty for
   * tunnels.
   */
  readonly deckUnderside: readonly DeckUndersidePoint[];
}

export interface DeckUndersidePoint {
  readonly station: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AsphaltRowMetadata {
  readonly station: number;
  readonly segmentId: string;
  readonly activeIntervalIds: readonly string[];
  readonly cutSourceIds: readonly string[];
}

export interface AsphaltMaterialGroup {
  readonly start: number;
  readonly count: number;
  readonly materialIndex: number;
}

export interface TrackContainmentResult {
  readonly station: number;
  readonly lateralOffset: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly inside: boolean;
}

export interface SurfaceSample {
  readonly station: number;
  readonly lateralOffset: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly slope: number;
  readonly banking: number;
}

export type SurfaceRegionType = 'asphalt' | 'curb' | 'runoff' | 'outside';

export interface SurfaceRegionResult extends TrackContainmentResult {
  readonly region: SurfaceRegionType;
  readonly side: TrackSide | 'center';
  readonly intervalId: string | null;
  readonly validLap: boolean;
}

export interface CompileResult {
  readonly generatedAtVersion: 1;
  readonly totalLength: number;
  readonly closed: boolean;
  readonly stationCuts: readonly ProcessedStationCut[];
  readonly crossSections: readonly TrackCrossSection[];
  readonly asphalt: AsphaltMeshData;
  readonly curbs: readonly SurfaceBandMeshData[];
  readonly runoffs: readonly SurfaceBandMeshData[];
  readonly structures: readonly StructureMeshData[];
}

export function compileTrackSurface(
  document: TrackDocument,
  lookup: StationLookup,
  rowCount = 384,
): CompileResult {
  const crossSections = generateCrossSections(document, lookup, rowCount);
  return {
    generatedAtVersion: 1,
    totalLength: lookup.totalLength,
    closed: lookup.closed,
    stationCuts: crossSections.map((section) => section.cut),
    crossSections,
    asphalt: generateAsphaltMesh(crossSections, lookup.closed),
    curbs: generateCurbMeshes(document, lookup, crossSections),
    runoffs: generateRunoffMeshes(document, lookup, crossSections),
    structures: generateStructureMeshes(document, lookup, crossSections),
  };
}

export function generateCrossSections(
  document: TrackDocument,
  lookup: StationLookup,
  rowCount = 384,
): TrackCrossSection[] {
  const repairedDocument = repairTrackContinuity(document);
  // A document with no segments has no geometry to sample. Station cut
  // collection still emits adaptive cuts at station 0, so bail out early to
  // avoid indexing an empty segment list (createSegment(undefined)). This
  // guards against transient degenerate documents (e.g. a deferred value
  // that lags one frame behind a freshly authored track).
  if (repairedDocument.segments.length === 0 || lookup.samples.length === 0) {
    return [];
  }
  const cuts = processStationCuts(
    collectStationCuts(repairedDocument, lookup, Math.max(2, Math.floor(rowCount))),
    lookup,
  ).cuts;
  const rows: {
    readonly station: number;
    readonly center: Vector2;
    readonly centerHeight: number;
    readonly leftWidth: number;
    readonly rightWidth: number;
    readonly cut: ProcessedStationCut;
    readonly segmentId: string;
    readonly activeIntervalIds: readonly string[];
  }[] = [];

  for (const cut of cuts) {
    const rowSample = evaluateCutOnSegment(repairedDocument, lookup, cut.station);
    const width = evaluateTrackWidth(repairedDocument, lookup, cut.station);
    const sector = findSectorAtStation(repairedDocument, lookup, cut.station);
    const curveElevation = evaluateStationValueCurve(repairedDocument.elevation, lookup, cut.station, 0);
    rows.push({
      station: cut.station,
      center: rowSample.center,
      centerHeight: rowSample.centerHeight + curveElevation,
      leftWidth: width.left,
      rightWidth: width.right,
      cut,
      segmentId: rowSample.segmentId,
      activeIntervalIds: sector ? [sector.id] : [],
    });
  }

  if (rows.length === 0) {
    const centerSample = evaluateStation(repairedDocument, lookup, 0);
    const width = evaluateTrackWidth(repairedDocument, lookup, 0);
    rows.push({
      station: centerSample.station,
      center: centerSample.position,
      centerHeight: 0,
      leftWidth: width.left,
      rightWidth: width.right,
      cut: {
        station: 0,
        sourceType: 'adaptive-curvature',
        sourceId: 'fallback',
        locked: false,
        optional: true,
        sources: [],
      },
      segmentId: '',
      activeIntervalIds: [],
    });
  }
  const bases = createStableSampleBases(rows, lookup.closed);
  const curvatures = computeRowCurvatures(rows, bases, lookup.closed);

  return rows.map((row, index) => {
    const { tangent, normal } = bases[index];
    const leftOffset = scale(normal, row.leftWidth);
    const rightOffset = scale(normal, -row.rightWidth);
    const banking = evaluateStationValueCurve(repairedDocument.banking, lookup, row.station, 0);
    const slope = stationValueDerivative(repairedDocument.elevation, lookup, row.station, 0);
    const bankRise = Math.sin(banking);

    return {
      station: row.station,
      center: row.center,
      centerHeight: row.centerHeight,
      tangent,
      normal,
      leftWidth: row.leftWidth,
      rightWidth: row.rightWidth,
      leftEdge: add(row.center, leftOffset),
      rightEdge: add(row.center, rightOffset),
      leftHeight: row.centerHeight + bankRise * row.leftWidth,
      rightHeight: row.centerHeight - bankRise * row.rightWidth,
      banking,
      slope,
      curvature: curvatures[index],
      cut: row.cut,
      segmentId: row.segmentId,
      activeIntervalIds: row.activeIntervalIds,
    };
  });
}

export function generateAsphaltMesh(
  crossSections: readonly TrackCrossSection[],
  closed: boolean,
): AsphaltMeshData {
  const rowCount = crossSections.length;
  const positions = new Float32Array(rowCount * 2 * 3);
  const normals = new Float32Array(rowCount * 2 * 3);
  const uvs = new Float32Array(rowCount * 2 * 2);
  const segmentCount = closed ? rowCount : Math.max(rowCount - 1, 0);
  const indices = new Uint32Array(segmentCount * 6);

  crossSections.forEach((section, row) => {
    writeVertexRow(positions, normals, uvs, row, rowCount, section);
  });

  // The base winding (left/right within a row, advancing to the next row) faces
  // up only when rows advance in a fixed circulation. A clockwise-authored loop
  // advances the opposite way around the same outward-anchored frame, so its
  // triangles would face down. Reverse the winding for clockwise loops to keep
  // the asphalt — and the seams that meet it — front-facing either way.
  const flip = isClockwiseLoop(crossSections, closed);
  for (let row = 0; row < segmentCount; row += 1) {
    const nextRow = (row + 1) % rowCount;
    const leftA = row * 2;
    const rightA = leftA + 1;
    const leftB = nextRow * 2;
    const rightB = leftB + 1;
    const indexOffset = row * 6;
    if (flip) {
      indices[indexOffset] = leftA;
      indices[indexOffset + 1] = leftB;
      indices[indexOffset + 2] = rightA;
      indices[indexOffset + 3] = rightA;
      indices[indexOffset + 4] = leftB;
      indices[indexOffset + 5] = rightB;
    } else {
      indices[indexOffset] = leftA;
      indices[indexOffset + 1] = rightA;
      indices[indexOffset + 2] = leftB;
      indices[indexOffset + 3] = rightA;
      indices[indexOffset + 4] = rightB;
      indices[indexOffset + 5] = leftB;
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    materialGroups: [
      {
        start: 0,
        count: indices.length,
        materialIndex: 0,
      },
    ],
    rowMetadata: crossSections.map((section) => ({
      station: section.station,
      segmentId: section.segmentId,
      activeIntervalIds: section.activeIntervalIds,
      cutSourceIds: section.cut.sources.map((source) => source.sourceId),
    })),
    rowCount,
  };
}

export function generateCurbMeshes(
  document: TrackDocument,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): SurfaceBandMeshData[] {
  return (document.curbs ?? [])
    .map((curb) => generateCurbMesh(curb, lookup, crossSections))
    .filter((mesh): mesh is SurfaceBandMeshData => mesh !== null);
}

export function generateRunoffMeshes(
  document: TrackDocument,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): SurfaceBandMeshData[] {
  return (document.runoffs ?? [])
    .map((runoff) => generateRunoffMesh(document, runoff, lookup, crossSections))
    .filter((mesh): mesh is SurfaceBandMeshData => mesh !== null);
}

// === Structures: tunnel bores and bridge decks ===========================
//
// Both are swept along the existing cross-section frames using
// `sampleSectionLateral`, exactly like curb/runoff bands, but produce a few
// extra columns each. The compiler stays terrain-blind: pillar feet and the
// portal-to-terrain fill are resolved by the editor (terrain-core) which has
// the heightfield. We export `deckUnderside` so the editor can drop pillars.

const BRIDGE_DECK_DEPTH = 1.4; // girder thickness below the asphalt deck (m)
const BRIDGE_END_RAMP = 12; // span-end length over which the underside lands (m)

export function generateStructureMeshes(
  document: TrackDocument,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): StructureMeshData[] {
  const spans = resolveStructureSpans(document, lookup);
  const tunnels = new Map((document.tunnels ?? []).map((tunnel) => [tunnel.id, tunnel]));
  const meshes: StructureMeshData[] = [];

  for (const span of spans) {
    if (span.kind === 'tunnel') {
      const tunnel = tunnels.get(span.id);
      if (!tunnel) {
        continue;
      }
      const mesh = generateTunnelBore(span, tunnel, lookup, crossSections);
      if (mesh) {
        meshes.push(mesh);
      }
    } else {
      const mesh = generateBridgeDeck(span, lookup, crossSections);
      if (mesh) {
        meshes.push(mesh);
      }
    }
  }

  return meshes;
}

// A box bore: left wall up, flat ceiling, right wall down. Columns:
//   0: left wall foot (deck level, -width/2)
//   1: left wall head (+height, -width/2)
//   2: right wall head (+height, +width/2)
//   3: right wall foot (deck level, +width/2)
// The lateral sign convention matches sampleSectionLateral: +lateral is the
// left normal. Faces wind so the interior is visible from inside the bore.
function generateTunnelBore(
  span: StructureSpan,
  tunnel: { readonly width: number; readonly height: number },
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): StructureMeshData | null {
  const half = tunnel.width / 2;
  const height = tunnel.height;
  const rows = crossSections.filter(
    (section) =>
      isStationInInterval(section.station, span.left.start, span.left.end, lookup) ||
      isStationInInterval(section.station, span.right.start, span.right.end, lookup),
  );
  if (rows.length < 2 || tunnel.width <= 0 || height <= 0) {
    return null;
  }

  const columnCount = 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  rows.forEach((section, row) => {
    const ring = [
      sampleSectionLateral(section, -half, 0),
      sampleSectionLateral(section, -half, height),
      sampleSectionLateral(section, half, height),
      sampleSectionLateral(section, half, 0),
    ];
    ring.forEach((vertex, column) => {
      positions.push(vertex.x, vertex.y, vertex.z);
      // Inward-facing normals (toward the bore centerline). Approximate with the
      // banked up-vector for the ceiling and the lateral normal for walls; a
      // post-pass recomputes from triangles, so this is only a seed.
      normals.push(0, 1, 0);
      uvs.push(column / (columnCount - 1), row / Math.max(rows.length - 1, 1));
    });
  });

  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < columnCount - 1; column += 1) {
      const a = row * columnCount + column;
      const b = a + 1;
      const c = (row + 1) * columnCount + column;
      const d = c + 1;
      // Wind so the interior (facing the centerline) is front-facing.
      indices.push(a, c, b, b, c, d);
    }
  }

  // Portal caps: fan the first and last rings to their centroid so the bore is
  // closed where it meets terrain. Skew is handled implicitly — each cap is a
  // quad-fan over that ring's four vertices at its own station.
  appendPortalCap(positions, normals, uvs, indices, 0, columnCount, true);
  appendPortalCap(positions, normals, uvs, indices, rows.length - 1, columnCount, false);

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  recomputeStructureNormals(positionArray, indices, normalArray);

  return {
    structureId: span.id,
    kind: 'tunnel',
    bandType: 'tunnelBore',
    columnCount,
    positions: positionArray,
    normals: normalArray,
    uvs: new Float32Array(uvs),
    indices: Uint32Array.from(indices),
    materialGroups: [{ start: 0, count: indices.length, materialIndex: 0 }],
    rowMetadata: rows.map((section) => ({
      station: section.station,
      segmentId: section.segmentId,
      activeIntervalIds: [span.id],
      cutSourceIds: section.cut.sources.map((source) => source.sourceId),
    })),
    rowCount: rows.length,
    deckUnderside: [],
  };
}

function appendPortalCap(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  row: number,
  columnCount: number,
  isStart: boolean,
) {
  const base = row * columnCount;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let column = 0; column < columnCount; column += 1) {
    cx += positions[(base + column) * 3];
    cy += positions[(base + column) * 3 + 1];
    cz += positions[(base + column) * 3 + 2];
  }
  cx /= columnCount;
  cy /= columnCount;
  cz /= columnCount;

  const centroidIndex = positions.length / 3;
  positions.push(cx, cy, cz);
  normals.push(0, 1, 0);
  uvs.push(0.5, isStart ? 0 : 1);

  for (let column = 0; column < columnCount; column += 1) {
    const a = base + column;
    const b = base + ((column + 1) % columnCount);
    if (isStart) {
      indices.push(centroidIndex, a, b);
    } else {
      indices.push(centroidIndex, b, a);
    }
  }
}

// A bridge deck underside/girder: a downward box from the left edge to the
// right edge, BRIDGE_DECK_DEPTH below the deck top, ramping to the deck top at
// the span ends so the bridge "lands". Columns:
//   0: left edge underside, 1: right edge underside.
function generateBridgeDeck(
  span: StructureSpan,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): StructureMeshData | null {
  const rows = crossSections.filter((section) =>
    isStationInInterval(section.station, span.left.start, span.left.end, lookup),
  );
  if (rows.length < 2) {
    return null;
  }

  const columnCount = 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const deckUnderside: DeckUndersidePoint[] = [];

  rows.forEach((section, row) => {
    // Ramp the girder depth from 0 at the mouths up to full depth in the span
    // interior, so the underside meets the asphalt deck where it lands.
    const ramp = intervalEndpointScale(span.left.start, span.left.end, lookup, section.station, BRIDGE_END_RAMP);
    const depth = BRIDGE_DECK_DEPTH * ramp;
    const left = sampleSectionLateral(section, section.leftWidth, -depth);
    const right = sampleSectionLateral(section, -section.rightWidth, -depth);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(0, -1, 0, 0, -1, 0);
    uvs.push(0, row / Math.max(rows.length - 1, 1), 1, row / Math.max(rows.length - 1, 1));

    // Underside centerline point for pillar drops (full-depth interior only).
    const center = sampleSectionLateral(section, 0, -depth);
    deckUnderside.push({ station: section.station, x: center.x, y: center.y, z: center.z });
  });

  for (let row = 0; row < rows.length - 1; row += 1) {
    const a = row * columnCount;
    const b = a + 1;
    const c = (row + 1) * columnCount;
    const d = c + 1;
    // Underside faces down.
    indices.push(a, b, c, b, d, c);
  }

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(normals);
  recomputeStructureNormals(positionArray, indices, normalArray);

  return {
    structureId: span.id,
    kind: 'bridge',
    bandType: 'bridgeDeck',
    columnCount,
    positions: positionArray,
    normals: normalArray,
    uvs: new Float32Array(uvs),
    indices: Uint32Array.from(indices),
    materialGroups: [{ start: 0, count: indices.length, materialIndex: 0 }],
    rowMetadata: rows.map((section) => ({
      station: section.station,
      segmentId: section.segmentId,
      activeIntervalIds: [span.id],
      cutSourceIds: section.cut.sources.map((source) => source.sourceId),
    })),
    rowCount: rows.length,
    deckUnderside,
  };
}

function recomputeStructureNormals(
  positions: Float32Array,
  indices: readonly number[],
  normals: Float32Array,
) {
  for (let i = 0; i < normals.length; i += 1) {
    normals[i] = 0;
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3] - ax;
    const by = positions[b * 3 + 1] - ay;
    const bz = positions[b * 3 + 2] - az;
    const cx = positions[c * 3] - ax;
    const cy = positions[c * 3 + 1] - ay;
    const cz = positions[c * 3 + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length > 1e-9) {
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    } else {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    }
  }
}

function generateCurbMesh(
  curb: CurbInterval,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): SurfaceBandMeshData | null {
  const rows = crossSections.filter((section) =>
    isBandRowActive(section.station, curb.startStation, curb.endStation, lookup),
  );
  if (rows.length < 2 || curb.width <= 0) {
    return null;
  }

  return generateProfileBandMesh({
    intervalId: curb.id,
    side: curb.side,
    bandType: 'curb',
    rows,
    getProfile: (section) => createCurbProfile(curb, lookup, section.station),
    closed: false,
  });
}

function generateRunoffMesh(
  document: TrackDocument,
  runoff: RunoffInterval,
  lookup: StationLookup,
  crossSections: readonly TrackCrossSection[],
): SurfaceBandMeshData | null {
  const rows = crossSections.filter((section) =>
    isBandRowActive(section.station, runoff.startStation, runoff.endStation, lookup),
  );
  if (rows.length < 2 || runoff.width <= 0) {
    return null;
  }

  return generateProfileBandMesh({
    intervalId: runoff.id,
    side: runoff.side,
    bandType: 'runoff',
    rows,
    getProfile: (section) => {
      const curb = findActiveCurb(document, lookup, section.station, runoff.side);
      const curbOffset = curb ? effectiveCurbWidth(curb, lookup, section.station) : 0;
      const curbHeight = curb ? effectiveCurbOuterHeight(curb, lookup, section.station) : 0;
      const runoffWidth = effectiveRunoffWidth(runoff, lookup, section.station);
      return [
        { offset: curbOffset, height: curbHeight },
        { offset: curbOffset + runoffWidth, height: 0 },
      ];
    },
    closed: false,
  });
}

interface BandProfilePoint {
  readonly offset: number;
  readonly height: number;
}

function generateProfileBandMesh(config: {
  readonly intervalId: string;
  readonly side: TrackSide;
  readonly bandType: 'curb' | 'runoff';
  readonly rows: readonly TrackCrossSection[];
  readonly getProfile: (section: TrackCrossSection) => readonly BandProfilePoint[];
  readonly closed: boolean;
}): SurfaceBandMeshData {
  const rowCount = config.rows.length;
  const firstProfile = config.getProfile(config.rows[0]);
  const columnCount = Math.max(firstProfile.length, 2);
  const positions = new Float32Array(rowCount * columnCount * 3);
  const normals = new Float32Array(rowCount * columnCount * 3);
  const uvs = new Float32Array(rowCount * columnCount * 2);
  const segmentCount = config.closed ? rowCount : Math.max(rowCount - 1, 0);
  const indices = new Uint32Array(segmentCount * Math.max(columnCount - 1, 0) * 6);
  const sign = config.side === 'left' ? 1 : -1;

  config.rows.forEach((section, row) => {
    const baseOffset = config.side === 'left' ? section.leftWidth : section.rightWidth;
    const profile = normalizedProfile(config.getProfile(section), columnCount);
    const maxOuter = maxLateralOffset(section, config.side);
    profile.forEach((point, column) => {
      const desired = baseOffset + Math.max(point.offset, 0);
      const lateral = sign * Math.min(desired, maxOuter);
      const vertex = sampleSectionLateral(section, lateral, point.height);
      writeBandVertex(positions, normals, uvs, row, column, rowCount, columnCount, section, vertex);
    });
  });

  // Left and right bands wind oppositely so both face up; a clockwise loop
  // reverses the row-advance direction around the outward-anchored frame, which
  // flips facing again, so fold the loop circulation into the side choice.
  const clockwise = isClockwiseLoop(config.rows, config.closed);
  const windAsLeft = (config.side === 'left') !== clockwise;
  for (let row = 0; row < segmentCount; row += 1) {
    const nextRow = (row + 1) % rowCount;
    for (let column = 0; column < columnCount - 1; column += 1) {
      const innerA = row * columnCount + column;
      const outerA = innerA + 1;
      const innerB = nextRow * columnCount + column;
      const outerB = innerB + 1;
      const indexOffset = (row * (columnCount - 1) + column) * 6;
      if (windAsLeft) {
        indices[indexOffset] = innerA;
        indices[indexOffset + 1] = outerA;
        indices[indexOffset + 2] = innerB;
        indices[indexOffset + 3] = outerA;
        indices[indexOffset + 4] = outerB;
        indices[indexOffset + 5] = innerB;
      } else {
        indices[indexOffset] = innerA;
        indices[indexOffset + 1] = innerB;
        indices[indexOffset + 2] = outerA;
        indices[indexOffset + 3] = outerA;
        indices[indexOffset + 4] = innerB;
        indices[indexOffset + 5] = outerB;
      }
    }
  }

  return {
    intervalId: config.intervalId,
    side: config.side,
    bandType: config.bandType,
    columnCount,
    positions,
    normals,
    uvs,
    indices,
    materialGroups: [{ start: 0, count: indices.length, materialIndex: 0 }],
    rowMetadata: config.rows.map((section) => ({
      station: section.station,
      segmentId: section.segmentId,
      activeIntervalIds: [config.intervalId],
      cutSourceIds: section.cut.sources.map((source) => source.sourceId),
    })),
    rowCount,
  };
}

// Largest lateral distance (from centerline, unsigned) a band on `side` may
// reach before its offset surface folds in a tight corner. A band laid on the
// concave side of a turn shrinks toward the center of curvature; once it passes
// the curvature radius the rows cross and the seam overlaps itself. We cap the
// outer edge at a safe fraction of that radius. The convex side never folds, so
// it is unconstrained (Infinity).
function maxLateralOffset(section: TrackCrossSection, side: TrackSide): number {
  const curvature = section.curvature;
  if (!Number.isFinite(curvature) || Math.abs(curvature) <= 1e-9) {
    return Number.POSITIVE_INFINITY;
  }
  // Positive curvature bends toward the left normal, so the left side is the
  // inside (concave) of the turn. The concave side is the one whose sign
  // matches the curvature sign: left (+) with positive curvature, right (-)
  // with negative curvature.
  const concaveIsLeft = curvature > 0;
  const sideIsConcave = side === 'left' ? concaveIsLeft : !concaveIsLeft;
  if (!sideIsConcave) {
    return Number.POSITIVE_INFINITY;
  }
  const radius = 1 / Math.abs(curvature);
  // Keep the outer edge at 90% of the radius: enough to stop the fold while
  // letting bands fill almost the whole inner shoulder on gentle curves.
  return radius * 0.9;
}

function normalizedProfile(
  profile: readonly BandProfilePoint[],
  columnCount: number,
): readonly BandProfilePoint[] {
  if (profile.length >= columnCount) {
    return profile;
  }

  const fallback = profile[profile.length - 1] ?? { offset: 0, height: 0 };
  return [...profile, ...Array.from({ length: columnCount - profile.length }, () => fallback)];
}

function createCurbProfile(
  curb: CurbInterval,
  lookup: StationLookup,
  station: number,
): readonly BandProfilePoint[] {
  const width = effectiveCurbWidth(curb, lookup, station);
  const height = effectiveCurbHeight(curb, lookup, station);
  return profileShape(curb.profile, width, height);
}

function profileShape(
  profile: CurbProfileType,
  width: number,
  height: number,
): readonly BandProfilePoint[] {
  if (width <= 1e-6 || height <= 1e-6) {
    return [
      { offset: 0, height: 0 },
      { offset: 0, height: 0 },
      { offset: 0, height: 0 },
      { offset: 0, height: 0 },
    ];
  }

  if (profile === 'flat') {
    return [
      { offset: 0, height: 0 },
      { offset: width, height: 0 },
      { offset: width, height: 0 },
      { offset: width, height: 0 },
    ];
  }

  if (profile === 'sawtooth') {
    return [
      { offset: 0, height: 0 },
      { offset: width * 0.35, height },
      { offset: width * 0.7, height: 0 },
      { offset: width, height },
    ];
  }

  return [
    { offset: 0, height: 0 },
    { offset: width * 0.25, height },
    { offset: width * 0.72, height },
    { offset: width, height },
  ];
}

function isBandRowActive(
  station: number,
  startStation: number,
  endStation: number,
  lookup: StationLookup,
): boolean {
  return isStationInInterval(station, startStation, endStation, lookup);
}

function effectiveCurbWidth(curb: CurbInterval, lookup: StationLookup, station: number): number {
  return (
    curb.width *
    intervalEndpointScale(curb.startStation, curb.endStation, lookup, station, curb.taperLength ?? 0)
  );
}

function effectiveCurbHeight(curb: CurbInterval, lookup: StationLookup, station: number): number {
  return (
    curb.height *
    intervalEndpointScale(curb.startStation, curb.endStation, lookup, station, curb.taperLength ?? 0)
  );
}

function effectiveCurbOuterHeight(curb: CurbInterval, lookup: StationLookup, station: number): number {
  const height = effectiveCurbHeight(curb, lookup, station);
  return curb.profile === 'flat' ? 0 : height;
}

function effectiveRunoffWidth(runoff: RunoffInterval, lookup: StationLookup, station: number): number {
  return (
    runoff.width *
    intervalEndpointScale(runoff.startStation, runoff.endStation, lookup, station, runoff.taperLength ?? 0)
  );
}

function intervalEndpointScale(
  startStation: number,
  endStation: number,
  lookup: StationLookup,
  station: number,
  taperLength = 0,
): number {
  const normalizedStation = normalizeStationForLength(station, lookup);
  const start = normalizeStationForLength(startStation, lookup);
  const end = normalizeStationForLength(endStation, lookup);
  const distanceFromStart = forwardIntervalDistance(start, normalizedStation, lookup);
  const distanceToEnd = forwardIntervalDistance(normalizedStation, end, lookup);
  const edgeDistance = Math.min(distanceFromStart, distanceToEnd);
  if (edgeDistance <= 1e-4) {
    return 0;
  }

  if (taperLength <= 1e-4) {
    return 1;
  }

  return Math.min(Math.max(edgeDistance / taperLength, 0), 1);
}

function forwardIntervalDistance(from: number, to: number, lookup: StationLookup): number {
  if (!lookup.closed) {
    return Math.max(to - from, 0);
  }

  return to >= from ? to - from : lookup.totalLength - from + to;
}

function normalizeStationForLength(station: number, lookup: StationLookup): number {
  if (!Number.isFinite(station) || lookup.totalLength <= 0) {
    return 0;
  }

  return lookup.closed
    ? ((station % lookup.totalLength) + lookup.totalLength) % lookup.totalLength
    : Math.min(Math.max(station, 0), lookup.totalLength);
}

function sampleSectionLateral(
  section: TrackCrossSection,
  lateralOffset: number,
  heightOffset: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: section.center.x + section.normal.x * lateralOffset,
    y: section.centerHeight + Math.sin(section.banking) * lateralOffset + heightOffset,
    z: section.center.y + section.normal.y * lateralOffset,
  };
}

function writeBandVertex(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  section: TrackCrossSection,
  vertex: { readonly x: number; readonly y: number; readonly z: number },
) {
  const vertexIndex = (row * columnCount + column) * 3;
  positions[vertexIndex] = vertex.x;
  positions[vertexIndex + 1] = vertex.y;
  positions[vertexIndex + 2] = vertex.z;

  const normal = normalized3({
    x: -section.normal.x * Math.sin(section.banking),
    y: Math.cos(section.banking),
    z: -section.normal.y * Math.sin(section.banking),
  });
  normals[vertexIndex] = normal.x;
  normals[vertexIndex + 1] = normal.y;
  normals[vertexIndex + 2] = normal.z;

  const uvRow = (row * columnCount + column) * 2;
  const v = rowCount <= 1 ? 0 : row / (rowCount - 1);
  uvs[uvRow] = columnCount <= 1 ? 0 : column / (columnCount - 1);
  uvs[uvRow + 1] = v;
}

export function getTrackContainment(
  document: TrackDocument,
  lookup: StationLookup,
  point: Vector2,
): TrackContainmentResult {
  const nearest = nearestStation(document, lookup, point);
  const lateralOffset = dot2(subtract(point, nearest.position), nearest.normal);
  const width = evaluateTrackWidth(document, lookup, nearest.station);

  return {
    station: nearest.station,
    lateralOffset,
    leftWidth: width.left,
    rightWidth: width.right,
    inside: lateralOffset <= width.left && lateralOffset >= -width.right,
  };
}

export function getSurfaceRegion(
  document: TrackDocument,
  lookup: StationLookup,
  point: Vector2,
): SurfaceRegionResult {
  const containment = getTrackContainment(document, lookup, point);
  const side: TrackSide | 'center' =
    containment.lateralOffset > containment.leftWidth
      ? 'left'
      : containment.lateralOffset < -containment.rightWidth
        ? 'right'
        : 'center';

  if (side === 'center') {
    return {
      ...containment,
      region: 'asphalt',
      side,
      intervalId: null,
      validLap: true,
    };
  }

  const baseWidth = side === 'left' ? containment.leftWidth : containment.rightWidth;
  const outsideDistance =
    side === 'left'
      ? containment.lateralOffset - containment.leftWidth
      : -containment.lateralOffset - containment.rightWidth;
  const curb = findActiveCurb(document, lookup, containment.station, side);
  const runoff = findActiveRunoff(document, lookup, containment.station, side);
  const limits = document.limits ?? { curbIsValid: true, runoffIsValid: false };

  const effectiveCurbWidthAtStation = curb ? effectiveCurbWidth(curb, lookup, containment.station) : 0;
  if (curb && outsideDistance <= effectiveCurbWidthAtStation) {
    return {
      ...containment,
      inside: true,
      leftWidth: side === 'left' ? baseWidth + effectiveCurbWidthAtStation : containment.leftWidth,
      rightWidth: side === 'right' ? baseWidth + effectiveCurbWidthAtStation : containment.rightWidth,
      region: 'curb',
      side,
      intervalId: curb.id,
      validLap: limits.curbIsValid,
    };
  }

  const runoffStart = effectiveCurbWidthAtStation;
  if (runoff && outsideDistance > runoffStart && outsideDistance <= runoffStart + runoff.width) {
    return {
      ...containment,
      inside: true,
      leftWidth: side === 'left' ? baseWidth + runoffStart + runoff.width : containment.leftWidth,
      rightWidth: side === 'right' ? baseWidth + runoffStart + runoff.width : containment.rightWidth,
      region: 'runoff',
      side,
      intervalId: runoff.id,
      validLap: limits.runoffIsValid,
    };
  }

  return {
    ...containment,
    region: 'outside',
    side,
    intervalId: null,
    validLap: false,
  };
}

export function sampleTrackSurface(
  surface: CompileResult,
  station: number,
  lateralOffset = 0,
): SurfaceSample {
  const sections = surface.crossSections;
  if (sections.length === 0) {
    return {
      station: 0,
      lateralOffset,
      position: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      slope: 0,
      banking: 0,
    };
  }

  const [before, after, alpha] = bracketCrossSections(sections, station, surface.totalLength);
  const center = interpolateVector(before.center, after.center, alpha);
  const lateral = normalize(interpolateVector(before.normal, after.normal, alpha), before.normal);
  const centerHeight = interpolate(before.centerHeight, after.centerHeight, alpha);
  const banking = interpolate(before.banking, after.banking, alpha);
  const slope = interpolate(before.slope, after.slope, alpha);

  return {
    station: interpolate(before.station, after.station, alpha),
    lateralOffset,
    position: {
      x: center.x + lateral.x * lateralOffset,
      y: centerHeight + Math.sin(banking) * lateralOffset,
      z: center.y + lateral.y * lateralOffset,
    },
    normal: normalized3({
      x: -lateral.x * Math.sin(banking),
      y: Math.cos(banking),
      z: -lateral.y * Math.sin(banking),
    }),
    slope,
    banking,
  };
}

function writeVertexRow(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  row: number,
  rowCount: number,
  section: TrackCrossSection,
) {
  const leftIndex = row * 6;
  const rightIndex = leftIndex + 3;
  positions[leftIndex] = section.leftEdge.x;
  positions[leftIndex + 1] = section.leftHeight;
  positions[leftIndex + 2] = section.leftEdge.y;
  positions[rightIndex] = section.rightEdge.x;
  positions[rightIndex + 1] = section.rightHeight;
  positions[rightIndex + 2] = section.rightEdge.y;

  const normal = normalized3({
    x: -section.normal.x * Math.sin(section.banking),
    y: Math.cos(section.banking),
    z: -section.normal.y * Math.sin(section.banking),
  });
  normals[leftIndex] = normal.x;
  normals[leftIndex + 1] = normal.y;
  normals[leftIndex + 2] = normal.z;
  normals[rightIndex] = normal.x;
  normals[rightIndex + 1] = normal.y;
  normals[rightIndex + 2] = normal.z;

  const uvRow = row * 4;
  const v = rowCount <= 1 ? 0 : row / (rowCount - 1);
  uvs[uvRow] = 0;
  uvs[uvRow + 1] = v;
  uvs[uvRow + 2] = 1;
  uvs[uvRow + 3] = v;
}

function bracketCrossSections(
  sections: readonly TrackCrossSection[],
  station: number,
  totalLength: number,
): [TrackCrossSection, TrackCrossSection, number] {
  if (sections.length === 1) {
    return [sections[0], sections[0], 0];
  }

  const finalStation = Math.max(totalLength, sections[sections.length - 1].station, 1e-9);
  const wrappedStation = ((station % finalStation) + finalStation) % finalStation;
  for (let index = 0; index < sections.length - 1; index += 1) {
    const before = sections[index];
    const after = sections[index + 1];
    if (wrappedStation >= before.station && wrappedStation <= after.station) {
      return [before, after, keyAlpha(before.station, after.station, wrappedStation)];
    }
  }

  const last = sections[sections.length - 1];
  const first = sections[0];
  const wrappedTarget = wrappedStation < first.station ? wrappedStation + finalStation : wrappedStation;
  const wrappedFirst = first.station + finalStation;
  return [last, first, keyAlpha(last.station, wrappedFirst, wrappedTarget)];
}

function interpolateVector(a: Vector2, b: Vector2, alpha: number): Vector2 {
  return {
    x: interpolate(a.x, b.x, alpha),
    y: interpolate(a.y, b.y, alpha),
  };
}

function normalized3(vector: { readonly x: number; readonly y: number; readonly z: number }) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return { x: 0, y: 1, z: 0 };
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function keyAlpha(start: number, end: number, station: number): number {
  return Math.min(Math.max((station - start) / Math.max(end - start, 1e-9), 0), 1);
}

function interpolate(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function dot2(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

function evaluateCutOnSegment(
  document: TrackDocument,
  lookup: StationLookup,
  station: number,
): { readonly center: Vector2; readonly centerHeight: number; readonly segmentId: string } {
  const segmentIndex = findSegmentIndexForStation(lookup, station);
  const segmentDocument = document.segments[segmentIndex];
  const segment = createSegment(segmentDocument);
  const segmentStart = lookup.segmentStartStations[segmentIndex] ?? 0;
  const segmentLength = Math.max(lookup.segmentLengths[segmentIndex] ?? segment.length(), 1e-9);
  const t = Math.min(Math.max((station - segmentStart) / segmentLength, 0), 1);

  return {
    center: segment.evaluate(t),
    centerHeight: evaluateSegmentElevation(segmentDocument, t),
    segmentId: segmentDocument.id,
  };
}

function findSegmentIndexForStation(lookup: StationLookup, station: number): number {
  if (lookup.segmentStartStations.length === 0) {
    return 0;
  }

  for (let index = lookup.segmentStartStations.length - 1; index >= 0; index -= 1) {
    if (station >= lookup.segmentStartStations[index] - 1e-6) {
      return index;
    }
  }

  return 0;
}

function evaluateSegmentElevation(segment: TrackDocument['segments'][number], t: number): number {
  return evaluateCubicScalar(
    segment.p0.elevation ?? 0,
    segment.p1.elevation ?? 0,
    segment.p2.elevation ?? 0,
    segment.p3.elevation ?? 0,
    t,
  );
}

function evaluateCubicScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const inverse = 1 - t;
  return (
    p0 * inverse * inverse * inverse +
    p1 * 3 * inverse * inverse * t +
    p2 * 3 * inverse * t * t +
    p3 * t * t * t
  );
}

interface SampleBasis {
  readonly tangent: Vector2;
  readonly normal: Vector2;
}

function createStableSampleBases(
  rows: readonly { readonly center: Vector2 }[],
  closed: boolean,
): SampleBasis[] {
  const bases = rows.map((_, index) => {
    const tangent = rowVertexTangent(rows, index, closed);
    return { tangent, normal: leftNormal(tangent) };
  });

  for (let index = 1; index < bases.length; index += 1) {
    if (dot2(bases[index].normal, bases[index - 1].normal) < 0) {
      bases[index] = flipBasis(bases[index]);
    }
  }

  if (closed && bases.length > 1 && dot2(bases[0].normal, bases[bases.length - 1].normal) < 0) {
    bases[0] = flipBasis(bases[0]);
  }

  // Frame-continuity above keeps adjacent normals from flipping, but it does
  // not tie the whole loop to a consistent global orientation: depending on
  // where the chain starts and how the bisector tangents resolve on tight
  // loops, the "left" normal can end up pointing into the loop interior
  // instead of out. Bands (curbs/runoffs) and the terrain skirt are laid out
  // by offsetting along ±normal, so an inverted loop pushes them toward the
  // inside — the longer wrap — which is the "shortest path" bug. It also flips
  // the handedness of the (tangent, normal) frame, which back-faces the asphalt
  // and seam triangles. For a closed loop we have a well-defined inside/outside,
  // so anchor the frame to a single convention — the left normal points to the
  // geometric *outside* — regardless of where sampling started or which way the
  // spline was authored. Measuring against the centroid (rather than the polygon
  // winding sign) makes this independent of clockwise vs. counter-clockwise
  // authoring: both windings resolve to the same outward-facing frame. Open
  // tracks have no enclosed area, so the local-continuity result is the only
  // sensible answer.
  if (closed && rows.length > 2 && !leftNormalPointsOutward(rows, bases)) {
    for (let index = 0; index < bases.length; index += 1) {
      bases[index] = flipBasis(bases[index]);
    }
  }

  return bases;
}

// Whether the frame's left normals point away from the loop centroid (outward)
// on balance. Summing the dot of each row's (center - centroid) with its left
// normal yields a winding-independent vote: positive means the frame already
// faces outward, negative means it is inverted and the whole loop should flip.
function leftNormalPointsOutward(
  rows: readonly { readonly center: Vector2 }[],
  bases: readonly SampleBasis[],
): boolean {
  let centroidX = 0;
  let centroidY = 0;
  for (const row of rows) {
    centroidX += row.center.x;
    centroidY += row.center.y;
  }
  centroidX /= rows.length;
  centroidY /= rows.length;

  let vote = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const outward = { x: rows[index].center.x - centroidX, y: rows[index].center.y - centroidY };
    vote += dot2(outward, bases[index].normal);
  }
  return vote >= 0;
}

// Signed curvature (1/m) at each row, derived from the turn between the
// incoming and outgoing centerline segments. The turn angle divided by the
// mean segment length approximates dθ/ds; its sign is taken relative to the
// row's left normal so positive curvature bends toward the left side. Endpoints
// of an open track reuse their neighbor's curvature (no enclosing geometry).
function computeRowCurvatures(
  rows: readonly { readonly center: Vector2 }[],
  bases: readonly SampleBasis[],
  closed: boolean,
): number[] {
  const curvatures = new Array<number>(rows.length).fill(0);
  if (rows.length < 3) {
    return curvatures;
  }

  for (let index = 0; index < rows.length; index += 1) {
    const isEndpoint = !closed && (index === 0 || index === rows.length - 1);
    if (isEndpoint) {
      continue;
    }
    const previous = rows[(index - 1 + rows.length) % rows.length].center;
    const current = rows[index].center;
    const next = rows[(index + 1) % rows.length].center;
    const incoming = subtract(current, previous);
    const outgoing = subtract(next, current);
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    const meanLength = (incomingLength + outgoingLength) / 2;
    if (meanLength <= 1e-6) {
      continue;
    }
    const incomingDir = normalize(incoming);
    const outgoingDir = normalize(outgoing, incomingDir);
    const cross = incomingDir.x * outgoingDir.y - incomingDir.y * outgoingDir.x;
    const dotDir = Math.min(Math.max(dot2(incomingDir, outgoingDir), -1), 1);
    const turn = Math.atan2(cross, dotDir);
    // Express the turn relative to the row's left normal so the sign is stable
    // even after the loop-winding flip in createStableSampleBases.
    const leftTurnSign = dot2(bases[index].normal, leftNormal(incomingDir)) >= 0 ? 1 : -1;
    curvatures[index] = (turn / meanLength) * leftTurnSign;
  }

  // Carry interior curvature out to open endpoints so band clamping there
  // matches the adjacent interior rather than reading a flat zero.
  if (!closed && rows.length >= 2) {
    curvatures[0] = curvatures[1];
    curvatures[rows.length - 1] = curvatures[rows.length - 2];
  }

  return curvatures;
}

// Whether a closed loop's centerline winds clockwise (negative shoelace area).
// Surface winding is authored for the counter-clockwise case; clockwise loops
// advance their rows the other way around the outward-anchored frame and must
// reverse their triangle winding to stay front-facing. Open tracks never wrap,
// so they are never "clockwise".
function isClockwiseLoop(sections: readonly { readonly center: Vector2 }[], closed: boolean): boolean {
  if (!closed || sections.length < 3) {
    return false;
  }
  let area = 0;
  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index].center;
    const next = sections[(index + 1) % sections.length].center;
    area += current.x * next.y - next.x * current.y;
  }
  return area < 0;
}

function flipBasis(basis: SampleBasis): SampleBasis {
  return {
    tangent: scale(basis.tangent, -1),
    normal: scale(basis.normal, -1),
  };
}

function rowVertexTangent(
  rows: readonly { readonly center: Vector2 }[],
  index: number,
  closed: boolean,
): Vector2 {
  if (rows.length < 2) {
    return { x: 1, y: 0 };
  }

  const previous = previousCenter(rows, index, closed);
  const current = rows[index].center;
  const next = nextCenter(rows, index, closed);
  const incoming = normalize(subtract(current, previous));
  const outgoing = normalize(subtract(next, current), incoming);
  const bisector = normalize(add(incoming, outgoing), outgoing);

  return dot2(bisector, outgoing) < 0 ? scale(bisector, -1) : bisector;
}

function previousCenter(
  rows: readonly { readonly center: Vector2 }[],
  index: number,
  closed: boolean,
): Vector2 {
  if (index > 0) {
    return rows[index - 1].center;
  }

  return closed ? rows[rows.length - 1].center : rows[index].center;
}

function nextCenter(
  rows: readonly { readonly center: Vector2 }[],
  index: number,
  closed: boolean,
): Vector2 {
  if (index < rows.length - 1) {
    return rows[index + 1].center;
  }

  return closed ? rows[0].center : rows[index].center;
}
