import centerlineRaw from './monzaCenterline.json';

/**
 * Autodromo Nazionale Monza — a faithful recreation of the circuit's layout.
 *
 * The geometry here is NOT hand-drawn. {@link centerlineRaw} is the real circuit's
 * survey centerline: the public OpenStreetMap-derived [lon, lat] trace of the 5,793 m
 * Grand Prix track (bacinger/f1-circuits, it-1922), projected to a local metric frame,
 * rotated so the Rettifilo main straight runs along +Z with the start/finish line at
 * the origin, resampled to a uniform ~2.2 m spacing, and uniformly scaled by
 * {@link MONZA_SCALE}. Because the scale is uniform, every proportion and corner radius
 * is exactly Monza's — the silhouette is the real track, just shrunk to fit a ~4 m car
 * and this sim's render budget.
 *
 * Corner sequence, clockwise from start/finish (used for kerb/run-off placement):
 *   Rettifilo straight → Variante del Rettifilo (T1-2 chicane) → Curva Grande /
 *   Biassono (T3, fast right) → Variante della Roggia (T4-5 chicane) → Curve di Lesmo
 *   (T6-7, double right) → Curva del Serraglio (long left) → Variante Ascari (T8-10
 *   chicane) → Curva Parabolica / Alboreto (T11, long right) → Rettifilo.
 *
 * EVERYTHING downstream — physics surface zones, kerbs, barriers, the start/finish
 * line, the lap-timer checkpoints, the HUD mini-map silhouette and scenery exclusion —
 * is derived from this single centerline. Physics treats the world as a flat plane
 * (SurfaceSystem), which matches the real, famously flat Monza, so this is geometry +
 * surface data only and never touches the validated vehicle dynamics.
 *
 * Source: bacinger/f1-circuits (MIT), © OpenStreetMap contributors (ODbL). Track
 * geometry is factual map data.
 */

export const MONZA_SCALE = 1 / 2;

/** Half the track width. Real Monza is 10–12 m wide; we use ~11 m, scaled. */
export const TRACK_HALF_WIDTH = (11 / 2) * MONZA_SCALE;

export type Vec2 = [number, number];

/** A sampled point on the centerline plus the unit tangent (direction of travel). */
export type CenterlinePoint = {
  pos: Vec2;
  tangent: Vec2; // unit, pointing forward along the lap
  /** Left-normal (unit), i.e. tangent rotated +90°, pointing to the track's left edge. */
  left: Vec2;
  /** Signed curvature (1/m, scaled frame). + = turning left, − = turning right. */
  curvature: number;
  /** Cumulative arc length from the start/finish line (scaled metres). */
  s: number;
};

const RAW = centerlineRaw as Vec2[];

/**
 * The Monza centerline with per-sample tangent, left-normal, curvature and arc length.
 * Curvature is estimated from the turn angle between adjacent tangents over the local
 * step, which is what the kerb/gravel placement keys off (corners = |curvature| high).
 */
export function buildMonzaCenterline(): CenterlinePoint[] {
  // Drop a duplicated closing point if present so neighbours wrap cleanly.
  const pts: Vec2[] = RAW.slice();
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3) pts.pop();
  }
  const n = pts.length;
  const out: CenterlinePoint[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    // Central-difference tangent for smoothness.
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // Left-normal = tangent rotated +90° (in x,z: (tx,tz) -> (-tz, tx)... but our z is
    // "forward"; left of forward +Z is −X, so left = (−tz, tx)).
    const lx = -tz, lz = tx;
    // Signed curvature from the heading change across this sample.
    const h0 = Math.atan2(cur[0] - prev[0], cur[1] - prev[1]);
    const h1 = Math.atan2(next[0] - cur[0], next[1] - cur[1]);
    let dh = h1 - h0;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const segLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    // dh>0 here means heading rotating toward +x; in our left=−x convention a right
    // turn (toward +x) is negative curvature, so negate. Suppress the seam at the
    // start/finish wrap (i==0) where prev/next straddle the loop join.
    const curvature = i === 0 ? 0 : -dh / segLen;
    if (i > 0) s += Math.hypot(cur[0] - pts[i - 1][0], cur[1] - pts[i - 1][1]);
    out.push({ pos: [cur[0], cur[1]], tangent: [tx, tz], left: [lx, lz], curvature, s });
  }
  return out;
}

/** Total scaled lap length of a centerline (metres). */
export function centerlineLength(line: CenterlinePoint[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    total += Math.hypot(line[i].pos[0] - line[i - 1].pos[0], line[i].pos[1] - line[i - 1].pos[1]);
  }
  // close the loop
  const a = line[0], b = line[line.length - 1];
  total += Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]);
  return total;
}

/** Axis-aligned bounding box of the centerline (for scenery exclusion + framing). */
export function centerlineBounds(line: CenterlinePoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of line) {
    minX = Math.min(minX, p.pos[0]); maxX = Math.max(maxX, p.pos[0]);
    minZ = Math.min(minZ, p.pos[1]); maxZ = Math.max(maxZ, p.pos[1]);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Both track edges as polylines (left/right of centerline by the half-width). */
export function trackEdges(line: CenterlinePoint[]): { left: Vec2[]; right: Vec2[] } {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (const p of line) {
    left.push([p.pos[0] + p.left[0] * TRACK_HALF_WIDTH, p.pos[1] + p.left[1] * TRACK_HALF_WIDTH]);
    right.push([p.pos[0] - p.left[0] * TRACK_HALF_WIDTH, p.pos[1] - p.left[1] * TRACK_HALF_WIDTH]);
  }
  return { left, right };
}
