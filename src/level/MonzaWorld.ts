import type { BarrierSpec, SurfaceZoneSpec, WorldSpec } from '../sim/types';
import type { StartFinishLine } from './LevelBuilder';
import {
  buildMonzaCenterline,
  centerlineBounds,
  TRACK_HALF_WIDTH,
  type CenterlinePoint,
} from './MonzaTrack';
import baseWorld from '../sim/data/testWorld.json';

/**
 * Builds the Monza {@link WorldSpec} (materials + surface zones + barriers) procedurally
 * from the circuit centerline. Reuses the validated material set from testWorld.json so
 * the tire/surface physics is unchanged; only the world's *shape* differs.
 *
 * Surface zones are axis-aligned rect/circle tests resolved last-match-wins by
 * SurfaceSystem.findZone, so ordering matters. Layering, low → high priority:
 *   1. one big GRASS rect as the base (everything off-track is grass),
 *   2. the ASPHALT ribbon, tiled as a chain of small axis-aligned squares following the
 *      centerline (so the car keeps full asphalt grip anywhere on the real ribbon),
 *   3. GRAVEL run-off patches at the Parabolica exit and chicane escape roads,
 *   4. KERB strips at the apex of each corner (highest priority — they must win over
 *      asphalt where they overlap the edge).
 */
export function buildMonzaWorld(): { world: WorldSpec; startFinish: StartFinishLine; centerline: CenterlinePoint[] } {
  const centerline = buildMonzaCenterline();
  const bounds = centerlineBounds(centerline);
  const zones: SurfaceZoneSpec[] = [];

  zones.push(...grassBase(bounds));
  zones.push(...asphaltRibbon(centerline));
  zones.push(...gravelTraps(centerline));
  zones.push(...kerbs(centerline));

  const barriers = outerBarriers(centerline);

  const world: WorldSpec = {
    gravity: baseWorld.gravity,
    defaultMaterialId: 'grass', // off the ribbon = grass; the asphalt tiles override it
    materials: baseWorld.materials as WorldSpec['materials'],
    zones,
    barriers,
  };

  const startFinish: StartFinishLine = {
    center: [0, 6], // a few metres up the main straight from the origin start pose
    width: TRACK_HALF_WIDTH * 2 + 0.6,
    depth: 1.2,
    headingRad: 0,
  };

  return { world, startFinish, centerline };
}

/** One large grass plane covering the whole footprint with margin. */
function grassBase(b: { minX: number; maxX: number; minZ: number; maxZ: number }): SurfaceZoneSpec[] {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX + 120;
  const d = b.maxZ - b.minZ + 120;
  return [{ id: 'grass_base', materialId: 'grass', type: 'rect', center: [cx, cz], size: [w, d], heightOffset: -0.03 }];
}

/**
 * The drivable asphalt, as a chain of axis-aligned square tiles centred on every
 * centerline sample. Each tile spans the full track width plus a little overlap so the
 * physics surface query never falls into a gap between samples mid-corner.
 */
function asphaltRibbon(line: CenterlinePoint[]): SurfaceZoneSpec[] {
  const out: SurfaceZoneSpec[] = [];
  // Tile side: cover the track width and the inter-sample step. Square (axis-aligned)
  // is conservative — it slightly overspills on the outside of corners, which only
  // means a hair more asphalt grip there, never less.
  const side = TRACK_HALF_WIDTH * 2 + 1.0;
  for (let i = 0; i < line.length; i++) {
    out.push({
      id: `asph_${i}`,
      materialId: 'asphalt_new',
      type: 'rect',
      center: [line[i].pos[0], line[i].pos[1]],
      size: [side, side],
      heightOffset: 0,
    });
  }
  return out;
}

/**
 * Gravel run-off where Monza has it: the outside of the Parabolica and the escape
 * roads at the three chicanes. Detected from the centerline by locating the
 * highest-curvature samples and dropping a gravel patch just outside the corner.
 */
function gravelTraps(line: CenterlinePoint[]): SurfaceZoneSpec[] {
  const out: SurfaceZoneSpec[] = [];
  const apices = findCornerApices(line);
  let n = 0;
  for (const idx of apices) {
    const p = line[idx];
    // Outside of the corner is opposite the turn direction: right turn (curvature<0)
    // runs off to the left edge's far side and vice-versa. Place the patch beyond the
    // outside edge, centred a touch ahead of the apex.
    const outsideSign = p.curvature < 0 ? 1 : -1; // +1 toward left-normal
    const off = TRACK_HALF_WIDTH + 4.5;
    const cx = p.pos[0] + p.left[0] * off * outsideSign;
    const cz = p.pos[1] + p.left[1] * off * outsideSign;
    out.push({
      id: `gravel_${n++}`,
      materialId: 'gravel',
      type: 'circle',
      center: [cx, cz],
      radius: 7.5,
      heightOffset: -0.02,
    });
  }
  return out;
}

/**
 * Red/white kerb strips on the inside edge of every corner (the apex kerb the cars
 * ride). One rect per apex, laid along the track tangent on the inside edge. The kerb
 * renderer in LevelBuilder gives these the sawtooth look; here they grant kerb grip.
 */
function kerbs(line: CenterlinePoint[]): SurfaceZoneSpec[] {
  const out: SurfaceZoneSpec[] = [];
  const apices = findCornerApices(line);
  let n = 0;
  for (const idx of apices) {
    const p = line[idx];
    const insideSign = p.curvature < 0 ? -1 : 1; // toward inside of the corner
    const off = TRACK_HALF_WIDTH - 0.25;
    const cx = p.pos[0] + p.left[0] * off * insideSign;
    const cz = p.pos[1] + p.left[1] * off * insideSign;
    // Kerb rect oriented to the dominant tangent axis (axis-aligned approximation).
    const alongZ = Math.abs(p.tangent[1]) >= Math.abs(p.tangent[0]);
    const len = 9;
    const wide = 1.0;
    out.push({
      id: `kerb_${n++}`,
      materialId: 'kerb',
      type: 'rect',
      center: [cx, cz],
      size: alongZ ? [wide, len] : [len, wide],
      heightOffset: 0.05,
    });
  }
  return out;
}

/**
 * A sparse chain of AABB barriers along the OUTER edge only, set back from the racing
 * line so they read as the circuit boundary (Armco/tyre wall) without catching the
 * car mid-corner. Placed every few samples beyond the outside edge.
 */
function outerBarriers(line: CenterlinePoint[]): BarrierSpec[] {
  const out: BarrierSpec[] = [];
  const setback = TRACK_HALF_WIDTH + 6;
  const stride = 6; // every N samples
  let n = 0;
  for (let i = 0; i < line.length; i += stride) {
    const p = line[i];
    // Outer edge follows the LEFT normal on the side away from the turn. On straights
    // (curvature≈0) put walls on BOTH sides; on corners only the outside.
    const sides: number[] = Math.abs(p.curvature) < 0.01 ? [1, -1] : [p.curvature < 0 ? 1 : -1];
    for (const sgn of sides) {
      const cx = p.pos[0] + p.left[0] * setback * sgn;
      const cz = p.pos[1] + p.left[1] * setback * sgn;
      // A short box roughly aligned to the tangent via its half-extents footprint.
      const alongZ = Math.abs(p.tangent[1]) >= Math.abs(p.tangent[0]);
      out.push({
        id: `wall_${n++}`,
        center: [cx, 0.6, cz],
        halfExtents: alongZ ? [0.3, 0.6, stride * 1.3] : [stride * 1.3, 0.6, 0.3],
      });
    }
  }
  return out;
}

/**
 * Find representative apex sample indices: local maxima of |curvature| that are spaced
 * apart, so each corner contributes one apex (not dozens of adjacent samples). Tuned to
 * surface Monza's ~11 turns / chicane elements.
 */
function findCornerApices(line: CenterlinePoint[]): number[] {
  const threshold = 0.02; // 1/m in the scaled frame; straights are ~0
  const minGap = 14; // samples between distinct apices
  const cand: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (Math.abs(line[i].curvature) >= threshold) cand.push(i);
  }
  // Greedy thinning by local-max within a window.
  const apices: number[] = [];
  for (const i of cand) {
    if (apices.length && i - apices[apices.length - 1] < minGap) {
      // keep whichever is sharper
      const prev = apices[apices.length - 1];
      if (Math.abs(line[i].curvature) > Math.abs(line[prev].curvature)) apices[apices.length - 1] = i;
      continue;
    }
    apices.push(i);
  }
  return apices;
}

/**
 * Lap-timer checkpoints sampled evenly around the centerline (excluding the immediate
 * start/finish region), plus the centerline polyline for the HUD mini-map. The car
 * must pass each checkpoint in order then cross the S/F plane to bank a lap.
 */
export function monzaCheckpoints(line: CenterlinePoint[]): Array<{ x: number; z: number; radius: number }> {
  const count = 10;
  const pts: Array<{ x: number; z: number; radius: number }> = [];
  for (let k = 1; k <= count; k++) {
    const idx = Math.floor((k / (count + 1)) * line.length);
    const p = line[idx];
    pts.push({ x: p.pos[0], z: p.pos[1], radius: TRACK_HALF_WIDTH + 6 });
  }
  return pts;
}

/** Centerline as a simple (x,z) polyline for the mini-map silhouette. */
export function monzaTrackPath(line: CenterlinePoint[]): Array<[number, number]> {
  const path: Array<[number, number]> = line.map((p) => [p.pos[0], p.pos[1]]);
  path.push([line[0].pos[0], line[0].pos[1]]);
  return path;
}
