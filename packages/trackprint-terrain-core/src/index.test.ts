import { describe, expect, it } from 'vitest';
import { compileTrackSurface } from '@trackprint/track-compiler';
import { createStationLookup } from '@trackprint/track-core';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import {
  applyTerrainBrush,
  applyTerrainMasks,
  appendTerrainBrushStroke,
  cellToWorld,
  createTerrainDocument,
  deserializeTerrainDocument,
  deriveCorridorBoundary,
  generateBridgePillars,
  generatePortalFill,
  generateSkirtMesh,
  generateTerrainMesh,
  sampleTerrainHeight,
  sampleTerrainMaterial,
  serializeTerrainDocument,
  validateTerrainBoundary,
  worldToCell,
  type StationRangeSet,
} from './index';

describe('terrain core', () => {
  it('converts between world and cells and samples height/material', () => {
    const terrain = createTerrainDocument({
      origin: { x: -10, z: -10 },
      size: { width: 20, depth: 20 },
      resolution: { columns: 3, rows: 3 },
      defaultHeight: 2,
      defaultMaterial: 'grass',
    });

    expect(worldToCell(terrain, { x: 0, z: 0 })).toEqual({ column: 1, row: 1 });
    expect(cellToWorld(terrain, { column: 2, row: 2 })).toEqual({ x: 10, z: 10 });
    expect(sampleTerrainHeight(terrain, { x: 0, z: 0 })).toBe(2);
    expect(sampleTerrainMaterial(terrain, { x: 0, z: 0 })).toBe('grass');
  });

  it('generates a terrain grid mesh', () => {
    const terrain = createTerrainDocument({ resolution: { columns: 4, rows: 3 } });
    const mesh = generateTerrainMesh(terrain);

    expect(mesh.positions.length).toBe(4 * 3 * 3);
    expect(mesh.indices.length).toBe((4 - 1) * (3 - 1) * 6);
    expect(mesh.colors?.length).toBe(mesh.positions.length);
    expect(mesh.normals.every(Number.isFinite)).toBe(true);
  });

  it('builds masks with locked corridor, skirt, and free terrain', () => {
    const surface = compileTrackSurface(createStraightTrackDocument(), createStationLookup(createStraightTrackDocument(), 8), 8);
    const boundary = deriveCorridorBoundary(surface);
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 90, depth: 60 },
      resolution: { columns: 31, rows: 21 },
    });
    const masked = applyTerrainMasks(terrain, boundary, { blendWidth: 8 });

    expect(masked.masks).toContain('locked');
    expect(masked.masks).toContain('skirt');
    expect(masked.masks).toContain('free');
  });

  it('uses track band outer edges as corridor boundary', () => {
    const document = {
      ...createStraightTrackDocument(),
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 4,
          materialId: 'runoff',
        },
      ],
    };
    const surface = compileTrackSurface(document, createStationLookup(document, 8), 8);
    const boundary = deriveCorridorBoundary(surface);
    const runoff = surface.runoffs[0];
    const outerColumn = runoff.columnCount - 1;

    expect(boundary.left[1].z).toBeCloseTo(runoff.positions[(1 * runoff.columnCount + outerColumn) * 3 + 2]);
  });

  it('takes the farthest active band as the corridor boundary', () => {
    // A curb with a wider runoff behind it on the same side: the boundary must
    // follow the outermost (runoff) edge, not the inner curb, so abutting and
    // stacked bands resolve to one continuous outer seam instead of notching
    // back to the nearer band.
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 1.5,
          height: 0.2,
          taperLength: 0,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 5,
          taperLength: 0,
          materialId: 'runoff',
        },
      ],
    };
    const surface = compileTrackSurface(document, createStationLookup(document, 8), 8);
    const boundary = deriveCorridorBoundary(surface);
    const runoff = surface.runoffs[0];
    const curb = surface.curbs[0];
    const center = surface.crossSections[1].center;

    const boundaryDistance = Math.hypot(boundary.left[1].x - center.x, boundary.left[1].z - center.y);
    const runoffOuter = (1 * runoff.columnCount + runoff.columnCount - 1) * 3;
    const curbOuter = (1 * curb.columnCount + curb.columnCount - 1) * 3;
    const runoffDistance = Math.hypot(runoff.positions[runoffOuter] - center.x, runoff.positions[runoffOuter + 2] - center.y);
    const curbDistance = Math.hypot(curb.positions[curbOuter] - center.x, curb.positions[curbOuter + 2] - center.y);

    expect(runoffDistance).toBeGreaterThan(curbDistance);
    expect(boundaryDistance).toBeCloseTo(runoffDistance);
  });

  it('generates a skirt whose seam vertices exactly match corridor vertices', () => {
    const surface = compileTrackSurface(createStraightTrackDocument(), createStationLookup(createStraightTrackDocument(), 8), 8);
    const boundary = deriveCorridorBoundary(surface);
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 90, depth: 60 },
      resolution: { columns: 31, rows: 21 },
      defaultHeight: -1,
    });
    const skirt = generateSkirtMesh(terrain, boundary, 6);
    const seam = skirt.seam[0];
    const inner = seam.innerVertexIndex * 3;

    expect(skirt.positions[inner]).toBeCloseTo(boundary.left[0].x);
    expect(skirt.positions[inner + 1]).toBeCloseTo(boundary.left[0].y);
    expect(skirt.positions[inner + 2]).toBeCloseTo(boundary.left[0].z);
    expect(skirt.indices.length).toBeGreaterThan(0);
    expect(skirt.positions[seam.outerVertexIndex * 3 + 1]).toBeCloseTo(-1);
  });

  it('stores one seam entry per corridor boundary vertex without z fighting', () => {
    const surface = compileTrackSurface(createStraightTrackDocument(), createStationLookup(createStraightTrackDocument(), 8), 8);
    const boundary = deriveCorridorBoundary(surface);
    const skirt = generateSkirtMesh(createTerrainDocument(), boundary, 5);

    expect(skirt.seam).toHaveLength(boundary.left.length + boundary.right.length);
    for (const seam of skirt.seam) {
      const inner = seam.innerVertexIndex * 3;
      const outer = seam.outerVertexIndex * 3;
      const distance = Math.hypot(skirt.positions[inner] - skirt.positions[outer], skirt.positions[inner + 2] - skirt.positions[outer + 2]);
      expect(distance).toBeGreaterThan(0.1);
    }
  });

  it('winds skirt faces consistently regardless of loop direction', () => {
    // The skirt material renders FrontSide, so the triangle winding (not just
    // the force-up shading normals) must face the same way no matter which
    // direction the loop was authored. A clockwise loop reverses the boundary
    // advance; without folding circulation into the per-side flip its skirt
    // faces wind the opposite way and cull away. Both authored directions must
    // yield the same facing sign.
    const terrain = createTerrainDocument({
      origin: { x: -120, z: -120 },
      size: { width: 240, depth: 240 },
      resolution: { columns: 61, rows: 61 },
      defaultHeight: -1,
    });

    const ccw = deriveCorridorBoundary(
      compileTrackSurface(createDefaultTrackDocument(), createStationLookup(createDefaultTrackDocument(), 32), 96),
    );
    const cwDoc = reverseLoop(createDefaultTrackDocument());
    const cw = deriveCorridorBoundary(compileTrackSurface(cwDoc, createStationLookup(cwDoc, 32), 96));

    const ccwFacing = meanGeometricNormalY(generateSkirtMesh(terrain, ccw, 6).positions, generateSkirtMesh(terrain, ccw, 6).indices);
    const cwFacing = meanGeometricNormalY(generateSkirtMesh(terrain, cw, 6).positions, generateSkirtMesh(terrain, cw, 6).indices);

    expect(Math.sign(ccwFacing)).toBe(Math.sign(cwFacing));
    expect(ccwFacing).not.toBe(0);
  });

  it('raises only free terrain cells', () => {
    const terrain = {
      ...createTerrainDocument({ resolution: { columns: 3, rows: 1 } }),
      masks: ['locked', 'skirt', 'free'] as const,
    };
    const edited = applyTerrainBrush(terrain, { x: 160, z: 0 }, {
      type: 'raise',
      radius: 400,
      strength: 2,
      falloff: 'constant',
    });

    expect(edited.heights[0]).toBe(0);
    expect(edited.heights[1]).toBe(0);
    expect(edited.heights[2]).toBe(2);
  });

  it('paints materials only in the free terrain mask', () => {
    const terrain = {
      ...createTerrainDocument({ resolution: { columns: 2, rows: 1 }, defaultMaterial: 'grass' }),
      masks: ['locked', 'free'] as const,
    };
    const edited = applyTerrainBrush(terrain, { x: 160, z: 0 }, {
      type: 'material',
      radius: 400,
      strength: 1,
      falloff: 'constant',
      targetMaterial: 'gravel',
    });

    expect(edited.materials).toEqual(['grass', 'gravel']);
  });

  it('smooths and flattens terrain without touching protected cells', () => {
    const terrain = {
      ...createTerrainDocument({ resolution: { columns: 3, rows: 1 } }),
      heights: [10, 0, 0],
      masks: ['locked', 'free', 'free'] as const,
    };
    const smoothed = applyTerrainBrush(terrain, { x: 0, z: 0 }, {
      type: 'smooth',
      radius: 400,
      strength: 1,
      falloff: 'constant',
    });
    const flattened = applyTerrainBrush(smoothed, { x: 0, z: 0 }, {
      type: 'flatten',
      radius: 400,
      strength: 1,
      falloff: 'constant',
      targetHeight: 3,
    });

    expect(smoothed.heights[0]).toBe(10);
    expect(smoothed.heights[1]).toBeGreaterThan(0);
    expect(flattened.heights).toEqual([10, 3, 3]);
  });

  it('saves and reloads terrain edits and brush stroke history', () => {
    const terrain = createTerrainDocument({ resolution: { columns: 2, rows: 1 } });
    const edited = applyTerrainBrush(terrain, { x: 160, z: 0 }, {
      type: 'raise',
      radius: 400,
      strength: 1,
      falloff: 'constant',
    });
    const withStroke = appendTerrainBrushStroke(edited, {
      id: 'stroke-a',
      type: 'raise',
      points: [{ x: 160, z: 0 }],
      radius: 400,
      strength: 1,
      falloff: 'constant',
      timestamp: 1,
    });
    const reloaded = deserializeTerrainDocument(serializeTerrainDocument(withStroke));

    expect(reloaded.heights).toEqual(withStroke.heights);
    expect(reloaded.materials).toEqual(withStroke.materials);
    expect(reloaded.brushStrokes).toHaveLength(1);
    expect(reloaded.brushStrokes[0].id).toBe('stroke-a');
  });

  it('preserves sculpted free terrain while masks and skirts rebuild after width edits', () => {
    const baseDocument = createStraightTrackDocument();
    const wideDocument = {
      ...baseDocument,
      width: {
        left: { constant: 14 },
        right: { constant: 14 },
      },
    };
    const terrain = createTerrainDocument({
      origin: { x: -30, z: -35 },
      size: { width: 110, depth: 70 },
      resolution: { columns: 45, rows: 31 },
    });
    const sculptPoint = { x: -25, z: -30 };
    const baseSurface = compileTrackSurface(baseDocument, createStationLookup(baseDocument, 8), 8);
    const baseBoundary = deriveCorridorBoundary(baseSurface);
    const sculpted = applyTerrainBrush(applyTerrainMasks(terrain, baseBoundary, { blendWidth: 6 }), sculptPoint, {
      type: 'raise',
      radius: 5,
      strength: 3,
      falloff: 'constant',
    });

    const wideSurface = compileTrackSurface(wideDocument, createStationLookup(wideDocument, 8), 8);
    const wideBoundary = deriveCorridorBoundary(wideSurface);
    const remasked = applyTerrainMasks(sculpted, wideBoundary, { blendWidth: 6 });
    const skirt = generateSkirtMesh(remasked, wideBoundary, 6);
    const terrainMesh = generateTerrainMesh(remasked);

    expect(sampleTerrainHeight(remasked, sculptPoint)).toBe(3);
    expect(remasked.masks).not.toEqual(sculpted.masks);
    expect(skirt.seam).toHaveLength(wideBoundary.left.length + wideBoundary.right.length);
    expect(terrainMesh.normals.every(Number.isFinite)).toBe(true);
  });

  it('updates seam heights and keeps skirt outer vertices on sculpted terrain after elevation edits', () => {
    const flatDocument = createStraightTrackDocument();
    const raisedDocument = {
      ...flatDocument,
      elevation: { keys: [{ station: 0, value: 4 }] },
    };
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 90, depth: 60 },
      resolution: { columns: 31, rows: 21 },
      defaultHeight: -2,
    });
    const flatBoundary = deriveCorridorBoundary(
      compileTrackSurface(flatDocument, createStationLookup(flatDocument, 8), 8),
    );
    const raisedBoundary = deriveCorridorBoundary(
      compileTrackSurface(raisedDocument, createStationLookup(raisedDocument, 8), 8),
    );
    const flatSkirt = generateSkirtMesh(terrain, flatBoundary, 6);
    const raisedSkirt = generateSkirtMesh(terrain, raisedBoundary, 6);
    const flatInner = flatSkirt.seam[0].innerVertexIndex * 3;
    const raisedInner = raisedSkirt.seam[0].innerVertexIndex * 3;
    const raisedOuter = raisedSkirt.seam[0].outerVertexIndex * 3;

    expect(flatSkirt.positions[flatInner + 1]).toBeCloseTo(0);
    expect(raisedSkirt.positions[raisedInner + 1]).toBeCloseTo(4);
    expect(raisedSkirt.positions[raisedOuter + 1]).toBeCloseTo(-2);
  });

  it('validates corridor bounds for repeated terrain recompiles', () => {
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -20 },
      size: { width: 40, depth: 40 },
      resolution: { columns: 11, rows: 11 },
    });
    const oversizedDocument = {
      ...createStraightTrackDocument(),
      width: {
        left: { constant: 35 },
        right: { constant: 35 },
      },
    };
    const boundary = deriveCorridorBoundary(
      compileTrackSurface(oversizedDocument, createStationLookup(oversizedDocument, 8), 8),
    );
    const issues = validateTerrainBoundary(terrain, boundary, { blendWidth: 8 });

    expect(issues.some((issue) => issue.code === 'terrain-bounds')).toBe(true);
  });

  it('suppresses skirt triangles over a structure span', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 48);
    const boundary = deriveCorridorBoundary(surface);
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 120, depth: 60 },
      resolution: { columns: 41, rows: 21 },
    });

    const full = generateSkirtMesh(terrain, boundary, 8, 6);
    const suppress: StationRangeSet = {
      ranges: [{ start: 10, end: 40 }],
      closed: lookup.closed,
      totalLength: lookup.totalLength,
    };
    const gapped = generateSkirtMesh(terrain, boundary, 8, 6, suppress, suppress);

    expect(gapped.indices.length).toBeLessThan(full.indices.length);
    // Vertices are still written (contiguous indices), only triangles dropped.
    expect(gapped.positions.length).toBe(full.positions.length);
  });

  it('keeps terrain free over a hole-suppressed span instead of locking it', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 48);
    const boundary = deriveCorridorBoundary(surface);
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 120, depth: 60 },
      resolution: { columns: 41, rows: 21 },
    });

    const baseline = applyTerrainMasks(terrain, boundary, { blendWidth: 8 });
    const lockedBaseline = baseline.masks.filter((mask) => mask === 'locked').length;
    expect(lockedBaseline).toBeGreaterThan(0);

    const suppress: StationRangeSet = {
      ranges: [{ start: 0, end: lookup.totalLength }],
      closed: lookup.closed,
      totalLength: lookup.totalLength,
    };
    const suppressed = applyTerrainMasks(terrain, boundary, { blendWidth: 8 }, suppress);
    const lockedSuppressed = suppressed.masks.filter((mask) => mask === 'locked').length;
    expect(lockedSuppressed).toBeLessThan(lockedBaseline);
  });

  it('drops pillars under a bridge deck down to terrain', () => {
    const base = createStraightTrackDocument();
    const document = {
      ...base,
      elevation: { keys: [{ station: 0, value: 25 }] },
      segments: base.segments.map((segment) => ({ ...segment, bridge: true })),
    };
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 48);
    const terrain = createTerrainDocument({
      origin: { x: -20, z: -30 },
      size: { width: 120, depth: 60 },
      resolution: { columns: 41, rows: 21 },
      defaultHeight: 0,
    });
    const pillars = generateBridgePillars(terrain, surface.structures, { pillarSpacing: 10 });
    expect(pillars).not.toBeNull();
    expect(pillars!.indices.length).toBeGreaterThan(0);
    expect(pillars!.positions.every(Number.isFinite)).toBe(true);
  });

  it('returns no portal fill when there are no tunnels', () => {
    const document = createStraightTrackDocument();
    const surface = compileTrackSurface(document, createStationLookup(document, 8), 8);
    const terrain = createTerrainDocument();
    expect(generatePortalFill(terrain, surface.structures)).toBeNull();
  });
});

// Reverse a closed loop's traversal direction without changing its geometry, so
// a counter-clockwise oval becomes the same oval authored clockwise.
function reverseLoop(document: ReturnType<typeof createDefaultTrackDocument>) {
  const segments = [...document.segments].reverse().map((segment) => ({
    ...segment,
    p0: segment.p3,
    p1: segment.p2,
    p2: segment.p1,
    p3: segment.p0,
  }));
  return { ...document, segments };
}

// Average upward component of the triangles' geometric normals (derived from the
// winding order, not the stored shading normals). Positive means the faces wind
// front-up rather than being culled away under FrontSide rendering.
function meanGeometricNormalY(positions: Float32Array, indices: Uint32Array): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acz = positions[c + 2] - positions[a + 2];
    // Y component of (ab × ac): abz*acx - abx*acz.
    sum += abz * acx - abx * acz;
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}
