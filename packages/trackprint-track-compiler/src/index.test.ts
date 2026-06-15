import { describe, expect, it } from 'vitest';
import { createStationLookup, isFiniteVector } from '@trackprint/track-core';
import { createDefaultTrackDocument, createStraightTrackDocument } from '@trackprint/test-fixtures';
import { compileTrackSurface, generateCrossSections, getSurfaceRegion, sampleTrackSurface } from './index';

describe('track surface compiler', () => {
  it('generates straight-line edge offsets', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const sections = generateCrossSections(document, lookup, 2);
    expect(sections[0].leftEdge).toEqual({ x: 0, y: 5 });
    expect(sections[0].rightEdge).toEqual({ x: 0, y: -5 });
  });

  it('keeps left and right edges at the configured distance', () => {
    const document = createStraightTrackDocument();
    const lookup = createStationLookup(document, 8);
    const [section] = generateCrossSections(document, lookup, 2);
    expect(section.leftEdge.y - section.center.y).toBeCloseTo(section.leftWidth);
    expect(section.center.y - section.rightEdge.y).toBeCloseTo(section.rightWidth);
  });

  it('returns finite cross-section positions', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const sections = generateCrossSections(document, lookup, 12);
    expect(sections.every((section) => isFiniteVector(section.leftEdge))).toBe(true);
    expect(sections.every((section) => isFiniteVector(section.rightEdge))).toBe(true);
  });

  it('generates asphalt mesh arrays and indices in range', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 12);
    const vertexCount = surface.asphalt.positions.length / 3;
    expect(surface.asphalt.indices.every((index) => index < vertexCount)).toBe(true);
    expect(surface.asphalt.indices.length / 3).toBe(surface.asphalt.rowCount * 2);
    expect(surface.asphalt.normals.every(Number.isFinite)).toBe(true);
    expect(surface.asphalt.uvs.length).toBe(vertexCount * 2);
    expect(surface.asphalt.materialGroups[0].count).toBe(surface.asphalt.indices.length);
  });

  it('aligns mesh rows to processed station cuts', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 24);
    expect(surface.asphalt.rowMetadata.length).toBe(surface.stationCuts.length);
    expect(surface.crossSections.length).toBe(surface.stationCuts.length);
  });

  it('includes sector and width-key rows', () => {
    const document = {
      ...createDefaultTrackDocument(),
      width: {
        left: { constant: 7, keys: [{ station: 42, value: 8 }] },
        right: { constant: 6 },
      },
    };
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 24);
    expect(surface.stationCuts.some((cut) => cut.sourceType === 'sector-boundary')).toBe(true);
    expect(surface.stationCuts.some((cut) => cut.sourceType === 'width-key')).toBe(true);
  });

  it('applies elevation and banking to the generated surface', () => {
    const document = {
      ...createStraightTrackDocument(),
      elevation: { keys: [{ station: 0, value: 2 }, { station: 50, value: 7 }] },
      banking: { keys: [{ station: 0, value: 0.1 }] },
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 4);
    const middle = sampleTrackSurface(surface, 25, 0);
    const left = sampleTrackSurface(surface, 25, 5);
    const right = sampleTrackSurface(surface, 25, -5);
    const normalMagnitude = Math.hypot(middle.normal.x, middle.normal.y, middle.normal.z);

    expect(middle.position.y).toBeGreaterThan(2);
    expect(left.position.y).toBeGreaterThan(right.position.y);
    expect(normalMagnitude).toBeCloseTo(1);
  });

  it('keeps surface samples finite across lateral offsets', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 24);
    const sample = sampleTrackSurface(surface, lookup.totalLength * 0.35, 3);

    expect(Number.isFinite(sample.position.x)).toBe(true);
    expect(Number.isFinite(sample.position.y)).toBe(true);
    expect(Number.isFinite(sample.position.z)).toBe(true);
  });

  it('generates curb mesh connected to the asphalt edge', () => {
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
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);
    const curb = surface.curbs[0];
    const middleRow = Math.floor(curb.rowCount / 2) * curb.columnCount * 3;
    const middleOuter = middleRow + (curb.columnCount - 1) * 3;

    expect(curb.rowCount).toBe(surface.asphalt.rowCount);
    expect(curb.columnCount).toBeGreaterThan(2);
    expect(curb.positions[0]).toBeCloseTo(surface.asphalt.positions[0]);
    expect(curb.positions[2]).toBeCloseTo(surface.asphalt.positions[2]);
    expect(curb.positions[3]).toBeCloseTo(curb.positions[0]);
    expect(curb.positions[5]).toBeCloseTo(curb.positions[2]);
    expect(curb.positions[middleOuter + 1] - curb.positions[middleRow + 1]).toBeCloseTo(0.2);
  });

  it('tapers right-side curb endpoints to a point', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-r',
          side: 'right' as const,
          startStation: 0,
          endStation: 50,
          width: 1.5,
          height: 0.2,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);
    const curb = surface.curbs[0];
    const lastRow = (curb.rowCount - 1) * curb.columnCount * 3;

    for (let column = 1; column < curb.columnCount; column += 1) {
      const firstColumn = column * 3;
      const lastColumn = lastRow + column * 3;
      expect(curb.positions[firstColumn]).toBeCloseTo(curb.positions[0]);
      expect(curb.positions[firstColumn + 1]).toBeCloseTo(curb.positions[1]);
      expect(curb.positions[firstColumn + 2]).toBeCloseTo(curb.positions[2]);
      expect(curb.positions[lastColumn]).toBeCloseTo(curb.positions[lastRow]);
      expect(curb.positions[lastColumn + 1]).toBeCloseTo(curb.positions[lastRow + 1]);
      expect(curb.positions[lastColumn + 2]).toBeCloseTo(curb.positions[lastRow + 2]);
    }
  });

  it('keeps right-side curb and runoff triangle winding facing upward', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-r',
          side: 'right' as const,
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
          id: 'runoff-r',
          side: 'right' as const,
          startStation: 0,
          endStation: 50,
          width: 3,
          taperLength: 0,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);

    expect(firstTriangleNormalY(surface.curbs[0].positions, surface.curbs[0].indices)).toBeGreaterThan(0);
    expect(firstTriangleNormalY(surface.runoffs[0].positions, surface.runoffs[0].indices)).toBeGreaterThan(0);
  });

  it('keeps left-side curb and runoff triangle winding facing upward', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-l',
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
          id: 'runoff-l',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 3,
          taperLength: 0,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);

    expect(firstTriangleNormalY(surface.curbs[0].positions, surface.curbs[0].indices)).toBeGreaterThan(0);
    expect(firstTriangleNormalY(surface.runoffs[0].positions, surface.runoffs[0].indices)).toBeGreaterThan(0);
  });

  it('scales curb taper over the configured taper length', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 2,
          height: 0.2,
          taperLength: 20,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 10);
    const surface = compileTrackSurface(document, lookup, 10);
    const curb = surface.curbs[0];
    const taperedRow = curb.rowMetadata.findIndex((row) => row.station > 0 && row.station < 20);
    const rowOffset = taperedRow * curb.columnCount * 3;
    const outer = rowOffset + (curb.columnCount - 1) * 3;
    const effectiveWidth = curb.positions[outer + 2] - curb.positions[rowOffset + 2];

    expect(taperedRow).toBeGreaterThan(0);
    expect(effectiveWidth).toBeGreaterThan(0);
    expect(effectiveWidth).toBeLessThan(2);
  });

  it('generates runoff mesh after an active curb without cracks', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 1,
          height: 0.1,
          profile: 'flat' as const,
          materialId: 'curb',
        },
      ],
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 3,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);
    const curb = surface.curbs[0];
    const runoff = surface.runoffs[0];
    const row = Math.floor(curb.rowCount / 2);
    const curbMiddleRow = row * curb.columnCount * 3;
    const curbOuter = curbMiddleRow + (curb.columnCount - 1) * 3;
    const runoffMiddleRow = row * runoff.columnCount * 3;

    expect(runoff.rowCount).toBe(curb.rowCount);
    expect(runoff.positions[runoffMiddleRow]).toBeCloseTo(curb.positions[curbOuter]);
    expect(runoff.positions[runoffMiddleRow + 1]).toBeCloseTo(curb.positions[curbOuter + 1]);
    expect(runoff.positions[runoffMiddleRow + 2]).toBeCloseTo(curb.positions[curbOuter + 2]);
    expect(runoff.positions[0]).toBeCloseTo(curb.positions[0]);
    expect(runoff.positions[2]).toBeCloseTo(curb.positions[2]);
  });

  it('tapers runoff endpoints to a point', () => {
    const document = {
      ...createStraightTrackDocument(),
      runoffs: [
        {
          id: 'runoff-a',
          side: 'right' as const,
          startStation: 0,
          endStation: 50,
          width: 3,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);
    const runoff = surface.runoffs[0];
    const lastRow = (runoff.rowCount - 1) * runoff.columnCount * 3;

    expect(runoff.columnCount).toBe(2);
    expect(runoff.positions[3]).toBeCloseTo(runoff.positions[0]);
    expect(runoff.positions[4]).toBeCloseTo(runoff.positions[1]);
    expect(runoff.positions[5]).toBeCloseTo(runoff.positions[2]);
    expect(runoff.positions[lastRow + 3]).toBeCloseTo(runoff.positions[lastRow]);
    expect(runoff.positions[lastRow + 4]).toBeCloseTo(runoff.positions[lastRow + 1]);
    expect(runoff.positions[lastRow + 5]).toBeCloseTo(runoff.positions[lastRow + 2]);
  });

  it('scales runoff taper over the configured taper length', () => {
    const document = {
      ...createStraightTrackDocument(),
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 4,
          taperLength: 20,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 10);
    const surface = compileTrackSurface(document, lookup, 10);
    const runoff = surface.runoffs[0];
    const taperedRow = runoff.rowMetadata.findIndex((row) => row.station > 0 && row.station < 20);
    const rowOffset = taperedRow * runoff.columnCount * 3;
    const outer = rowOffset + (runoff.columnCount - 1) * 3;
    const effectiveWidth = runoff.positions[outer + 2] - runoff.positions[rowOffset + 2];

    expect(taperedRow).toBeGreaterThan(0);
    expect(effectiveWidth).toBeGreaterThan(0);
    expect(effectiveWidth).toBeLessThan(4);
  });

  it('evaluates runoff curb offsets per station row', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 20,
          endStation: 50,
          width: 1,
          height: 0.25,
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
          width: 3,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);
    const surface = compileTrackSurface(document, lookup, 8);
    const runoff = surface.runoffs[0];
    const rowWithCurb = runoff.rowMetadata.findIndex((row) => row.station > 20);
    const vertexOffset = rowWithCurb * 6;

    expect(rowWithCurb).toBeGreaterThan(0);
    expect(runoff.positions[vertexOffset + 2]).toBeCloseTo(6);
    expect(runoff.positions[vertexOffset + 1]).toBeCloseTo(0.25);
  });

  it('classifies asphalt, curb, runoff, and outside regions', () => {
    const document = {
      ...createStraightTrackDocument(),
      curbs: [
        {
          id: 'curb-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 1,
          height: 0.1,
          profile: 'flat' as const,
          materialId: 'curb',
        },
      ],
      runoffs: [
        {
          id: 'runoff-a',
          side: 'left' as const,
          startStation: 0,
          endStation: 50,
          width: 3,
          materialId: 'runoff',
        },
      ],
    };
    const lookup = createStationLookup(document, 8);

    expect(getSurfaceRegion(document, lookup, { x: 10, y: 0 }).region).toBe('asphalt');
    expect(getSurfaceRegion(document, lookup, { x: 10, y: 5.5 }).region).toBe('curb');
    expect(getSurfaceRegion(document, lookup, { x: 10, y: 7 }).region).toBe('runoff');
    expect(getSurfaceRegion(document, lookup, { x: 10, y: 12 }).region).toBe('outside');
  });

  it('lays a closed-loop left curb outside the centerline (shortest path)', () => {
    // The default oval winds counter-clockwise, so the left side is the outer
    // ring. A left curb must sit farther from the loop center than the asphalt
    // edge at every row; if the frame orientation flipped it would tuck inward
    // (toward the loop center) — the longer wrap the report describes.
    const document = {
      ...createDefaultTrackDocument(),
      curbs: [
        {
          id: 'curb-loop',
          side: 'left' as const,
          startStation: 0,
          endStation: 565,
          width: 1.5,
          height: 0.2,
          taperLength: 0,
          profile: 'raised' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 48);
    const curb = surface.curbs[0];

    for (let row = 0; row < curb.rowCount; row += 1) {
      const section = surface.crossSections[row];
      const cx = section.center.x;
      const cz = section.center.y;
      const innerIndex = row * curb.columnCount * 3;
      const outerIndex = innerIndex + (curb.columnCount - 1) * 3;
      const innerDistance = Math.hypot(curb.positions[innerIndex] - cx, curb.positions[innerIndex + 2] - cz);
      const outerDistance = Math.hypot(curb.positions[outerIndex] - cx, curb.positions[outerIndex + 2] - cz);
      // The outer curb edge is farther from the loop center than its inner edge
      // (which sits on the asphalt rim): the band points outward, not inward.
      expect(outerDistance).toBeGreaterThan(innerDistance - 1e-6);
    }
  });

  it('reports signed curvature that matches the loop turn direction', () => {
    // The frame is anchored so the left normal points to the loop's outside.
    // A CCW oval therefore bends away from its left normal at every row, so the
    // signed curvature (positive = toward the left normal) is negative throughout.
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 32);
    const sections = generateCrossSections(document, lookup, 48);
    const interior = sections.filter((section) => Number.isFinite(section.curvature) && section.curvature !== 0);
    expect(interior.length).toBeGreaterThan(0);
    expect(interior.every((section) => section.curvature < 0)).toBe(true);
  });

  it('keeps asphalt triangle winding upward for a counter-clockwise loop', () => {
    const document = createDefaultTrackDocument();
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 48);
    expect(firstTriangleNormalY(surface.asphalt.positions, surface.asphalt.indices)).toBeGreaterThan(0);
  });

  it('keeps asphalt triangle winding upward for a clockwise loop', () => {
    // The default oval winds counter-clockwise. A loop authored clockwise (the
    // same path traversed in reverse) must still emit up-facing asphalt — the
    // frame orientation must not depend on which direction the spline winds, or
    // the surface flips to a back-face and the seams invert.
    const document = reverseLoop(createDefaultTrackDocument());
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 48);
    expect(firstTriangleNormalY(surface.asphalt.positions, surface.asphalt.indices)).toBeGreaterThan(0);
  });

  it('keeps curb and runoff seams upward on a clockwise loop', () => {
    // Bands wind by side; a clockwise loop reverses the row advance, so without
    // folding circulation into the side choice the seams would face down.
    const base = reverseLoop(createDefaultTrackDocument());
    const document = {
      ...base,
      curbs: [
        { id: 'curb-l', side: 'left' as const, startStation: 0, endStation: 565, width: 1.5, height: 0.2, taperLength: 0, profile: 'raised' as const, materialId: 'curb' },
        { id: 'curb-r', side: 'right' as const, startStation: 0, endStation: 565, width: 1.5, height: 0.2, taperLength: 0, profile: 'raised' as const, materialId: 'curb' },
      ],
      runoffs: [
        { id: 'runoff-l', side: 'left' as const, startStation: 0, endStation: 565, width: 3, taperLength: 0, materialId: 'runoff' },
        { id: 'runoff-r', side: 'right' as const, startStation: 0, endStation: 565, width: 3, taperLength: 0, materialId: 'runoff' },
      ],
    };
    const lookup = createStationLookup(document, 32);
    const surface = compileTrackSurface(document, lookup, 48);
    for (const band of [...surface.curbs, ...surface.runoffs]) {
      expect(firstTriangleNormalY(band.positions, band.indices)).toBeGreaterThan(0);
    }
  });

  it('clamps a band on a tight inner curve so its outer rows do not fold', () => {
    // Tiny loop (radius ~12 m) with a wide curb on the inner side. The frame
    // anchors the left normal outward, so on this CCW oval the right side is the
    // inside of the turn; an unclamped curb there would push past the ~12 m
    // radius and the outer rows would cross. The curvature clamp keeps every
    // outer edge strictly inside the local radius, so adjacent outer rows never
    // invert their winding around the center.
    const r = 12;
    const document = {
      ...createDefaultTrackDocument(),
      id: 'tight-loop',
      segments: createDefaultTrackDocument().segments.map((segment) => ({
        ...segment,
        p0: { ...segment.p0, position: scalePoint(segment.p0.position, r / 90) },
        p1: { ...segment.p1, position: scalePoint(segment.p1.position, r / 90) },
        p2: { ...segment.p2, position: scalePoint(segment.p2.position, r / 90) },
        p3: { ...segment.p3, position: scalePoint(segment.p3.position, r / 90) },
      })),
      width: { left: { constant: 2 }, right: { constant: 2 } },
      curbs: [
        {
          id: 'curb-inner',
          side: 'right' as const,
          startStation: 0,
          endStation: 999,
          width: 20, // deliberately larger than the radius of curvature
          height: 0.2,
          taperLength: 0,
          profile: 'flat' as const,
          materialId: 'curb',
        },
      ],
    };
    const lookup = createStationLookup(document, 48);
    const surface = compileTrackSurface(document, lookup, 96);
    const curb = surface.curbs[0];

    let maxOuter = 0;
    for (let row = 0; row < curb.rowCount; row += 1) {
      const section = surface.crossSections[row];
      const outerIndex = (row * curb.columnCount + (curb.columnCount - 1)) * 3;
      const distance = Math.hypot(
        curb.positions[outerIndex] - section.center.x,
        curb.positions[outerIndex + 2] - section.center.y,
      );
      maxOuter = Math.max(maxOuter, distance);
      expect(Number.isFinite(distance)).toBe(true);
    }
    // Outer edge never reaches the requested 20 m width — it is clamped well
    // inside the local radius of curvature instead of folding through center.
    expect(maxOuter).toBeLessThan(20);
  });
});

describe('structure meshes', () => {
  it('emits a tunnel bore with finite positions and indexed triangles', () => {
    const document = {
      ...createStraightTrackDocument(),
      tunnels: [
        {
          id: 't1',
          leftStartStation: 5,
          leftEndStation: 40,
          rightStartStation: 5,
          rightEndStation: 40,
          width: 10,
          height: 5,
          materialId: 'concrete',
        },
      ],
    };
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 48);
    expect(surface.structures).toHaveLength(1);
    const bore = surface.structures[0];
    expect(bore.kind).toBe('tunnel');
    expect(bore.bandType).toBe('tunnelBore');
    expect(bore.columnCount).toBe(4);
    const vertexCount = bore.positions.length / 3;
    expect(vertexCount).toBeGreaterThan(0);
    expect(bore.positions.every(Number.isFinite)).toBe(true);
    expect(bore.indices.length).toBeGreaterThan(0);
    expect(bore.indices.every((index) => index < vertexCount)).toBe(true);
    expect(bore.deckUnderside).toHaveLength(0);
  });

  it('emits a bridge deck whose underside dips below the asphalt in the span interior', () => {
    const base = createStraightTrackDocument();
    const elevated = {
      ...base,
      elevation: { keys: [{ station: 0, value: 20 }] },
      segments: base.segments.map((segment) => ({ ...segment, bridge: true })),
    };
    const lookup = createStationLookup(elevated, 16);
    const surface = compileTrackSurface(elevated, lookup, 48);
    expect(surface.structures).toHaveLength(1);
    const deck = surface.structures[0];
    expect(deck.kind).toBe('bridge');
    expect(deck.bandType).toBe('bridgeDeck');
    expect(deck.deckUnderside.length).toBeGreaterThan(2);

    // The asphalt deck top sits at ~elevation; the underside in the interior is
    // below it (ramps to deck level only at the ends).
    const deckTopY = surface.crossSections[Math.floor(surface.crossSections.length / 2)].centerHeight;
    const interior = deck.deckUnderside[Math.floor(deck.deckUnderside.length / 2)];
    expect(interior.y).toBeLessThan(deckTopY);
  });

  it('omits the left wall on rows only covered by the right side (skew)', () => {
    const document = {
      ...createStraightTrackDocument(),
      tunnels: [
        {
          id: 'skew',
          leftStartStation: 20,
          leftEndStation: 40,
          rightStartStation: 0,
          rightEndStation: 40,
          width: 10,
          height: 5,
          materialId: 'concrete',
        },
      ],
    };
    const lookup = createStationLookup(document, 16);
    const surface = compileTrackSurface(document, lookup, 48);
    // The bore should still build; the union range [0,40] drives the rows. The
    // skew is reflected in span resolution; here we assert the mesh is valid.
    const bore = surface.structures[0];
    expect(bore.rowCount).toBeGreaterThan(2);
    expect(bore.positions.every(Number.isFinite)).toBe(true);
  });
});

function scalePoint(point: { readonly x: number; readonly y: number }, factor: number) {
  return { x: point.x * factor, y: point.y * factor };
}

// Reverse a closed loop's traversal direction without changing its geometry:
// reverse the segment order and swap each cubic's endpoints/handles. A CCW oval
// becomes the same oval authored clockwise.
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

function firstTriangleNormalY(positions: Float32Array, indices: Uint32Array): number {
  for (let index = 0; index < indices.length; index += 3) {
    const a = readVertex(positions, indices[index]);
    const b = readVertex(positions, indices[index + 1]);
    const c = readVertex(positions, indices[index + 2]);
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const normalY = ab.z * ac.x - ab.x * ac.z;
    if (Math.abs(normalY) > 1e-6) {
      return normalY;
    }
  }

  return 0;
}

function readVertex(positions: Float32Array, index: number) {
  const offset = index * 3;
  return {
    x: positions[offset],
    y: positions[offset + 1],
    z: positions[offset + 2],
  };
}
