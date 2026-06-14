// Regenerates src/level/monzaCenterline.json deterministically from the real Monza
// survey coordinates (OpenStreetMap-derived, via bacinger/f1-circuits it-1922 — factual
// map data). Idempotent: it always reads from the immutable COORDS array below and
// writes the JSON, so re-running can never drift. Pipeline:
//   lon/lat -> local metres (equirectangular) -> rotate so the long Rettifilo straight
//   runs along +Z with the S/F line at the origin -> scale 1:3 -> resample uniformly.
import { writeFileSync } from 'node:fs';

const COORDS = [
  [9.281223,45.618975],[9.281692,45.622832],[9.281905,45.624449],[9.281928,45.624515],[9.281994,45.624553],[9.282076,45.624562],[9.282177,45.624553],[9.282272,45.624548],[9.28236,45.624553],[9.28242,45.624586],[9.282467,45.624633],[9.282479,45.624675],[9.282479,45.624722],[9.282147,45.625604],[9.2821,45.625844],[9.282082,45.626061],[9.282106,45.626297],[9.28223,45.627447],[9.282278,45.627635],[9.282337,45.62781],[9.282426,45.627998],[9.282544,45.628201],[9.28268,45.628399],[9.282881,45.628621],[9.283088,45.628804],[9.283367,45.629012],[9.283669,45.629196],[9.284006,45.629365],[9.284367,45.629511],[9.284775,45.629653],[9.285184,45.629752],[9.285634,45.629841],[9.286143,45.629903],[9.286664,45.629936],[9.288694,45.630058],[9.29118,45.630162],[9.291328,45.630171],[9.291405,45.6302],[9.29147,45.630247],[9.291552,45.63045],[9.291588,45.630506],[9.291647,45.630544],[9.291748,45.630567],[9.292085,45.63061],[9.292452,45.630666],[9.292973,45.630784],[9.295299,45.631331],[9.2955,45.631364],[9.29569,45.631364],[9.295873,45.63134],[9.296003,45.631303],[9.296128,45.631251],[9.296246,45.631194],[9.296394,45.631081],[9.296477,45.630992],[9.296536,45.630883],[9.296566,45.630761],[9.296666,45.629988],[9.296856,45.628668],[9.29685,45.62855],[9.29682,45.628474],[9.296773,45.628408],[9.296696,45.628361],[9.296554,45.628295],[9.295033,45.62772],[9.293796,45.627235],[9.293026,45.626938],[9.292653,45.626787],[9.292233,45.62658],[9.291931,45.626419],[9.291671,45.626259],[9.290321,45.625448],[9.289363,45.62484],[9.287338,45.623596],[9.286119,45.622846],[9.285953,45.622728],[9.285888,45.622653],[9.285876,45.622578],[9.285876,45.622488],[9.285918,45.62229],[9.28593,45.622182],[9.28593,45.622026],[9.285912,45.621941],[9.285864,45.621833],[9.285793,45.621706],[9.285675,45.621578],[9.285515,45.621446],[9.285332,45.621338],[9.285184,45.621258],[9.285107,45.621196],[9.285048,45.621112],[9.284994,45.620956],[9.28487,45.620244],[9.28474,45.619485],[9.283734,45.612679],[9.283692,45.612434],[9.283651,45.61232],[9.283568,45.612203],[9.283455,45.612108],[9.283325,45.612023],[9.283142,45.611939],[9.282941,45.611887],[9.28271,45.611858],[9.282514,45.611868],[9.282331,45.611896],[9.282118,45.611953],[9.281911,45.612019],[9.281757,45.612094],[9.281573,45.612193],[9.281366,45.612349],[9.281224,45.61249],[9.2811,45.612641],[9.280993,45.61282],[9.280893,45.613018],[9.280816,45.613221],[9.28078,45.613395],[9.280739,45.613659],[9.280733,45.613923],[9.280727,45.614173],[9.280709,45.614668],[9.280697,45.615102],[9.280709,45.615573],[9.280786,45.61619],[9.281076,45.618142],[9.281223,45.618975],
];

const lat0 = COORDS.reduce((a, p) => a + p[1], 0) / COORDS.length;
const lon0 = COORDS.reduce((a, p) => a + p[0], 0) / COORDS.length;
const R = 6378137, d2r = Math.PI / 180;
const metres = COORDS.map(([lon, lat]) => [(lon - lon0) * d2r * R * Math.cos(lat0 * d2r), (lat - lat0) * d2r * R]);

// Rotate so the straight from the S/F line (idx 0) to the next surveyed vertex (idx 1,
// ~430 m up the dead-straight Rettifilo) runs along +Z, S/F at the origin.
const p0 = metres[0];
const b = metres[1];
const ang = Math.atan2(b[0] - p0[0], b[1] - p0[1]);
const c = Math.cos(-ang), s = Math.sin(-ang);
const SCALE = 1 / 2;
const rotated = metres.map((p) => {
  const dx = p[0] - p0[0], dy = p[1] - p0[1];
  return [(dx * c - dy * s) * SCALE, (dx * s + dy * c) * SCALE];
});

// Uniform resample (~1.3 m steps) for a high-resolution ribbon + fine physics tiles.
function resample(line, step) {
  const out = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) continue;
    let dist = carry;
    while (dist + step <= segLen) {
      dist += step;
      const t = dist / segLen;
      out.push([ax + dx * t, ay + dy * t]);
    }
    carry = dist + step - segLen;
  }
  return out;
}

let sampled = resample(rotated, 1.3);

// The Rettifilo is dead-straight for its first ~110 m but the idx0→idx1 chord above
// leaves a small residual lean. Measure it from the verified-linear run (samples 2..40,
// all on the straight) and rotate it out exactly, so the car — which spawns at the
// origin heading +Z — drives straight down the main straight on the asphalt.
{
  const a = sampled[2], e = sampled[40];
  const lean = Math.atan2(e[0] - a[0], e[1] - a[1]);
  const cc = Math.cos(lean), ss = Math.sin(lean);
  sampled = sampled.map((p) => [p[0] * cc - p[1] * ss, p[0] * ss + p[1] * cc]);
}

// Mirror across X (negate x). The survey data, projected straight, puts Monza's first
// corner toward +X. But the chase camera looks along the car's forward +Z, and in that
// view world +X is screen-LEFT — so an un-mirrored +X corner would feel like a left turn
// even though Monza's first corner is a right. Negating x makes the first corner go −X,
// which reads as a RIGHT turn from the driver's seat, matching the real circuit. The
// HUD mini-map compensates by flipping its own x-axis so it still shows "right".
sampled = sampled.map((p) => [-p[0], p[1]]);

sampled = sampled.map((p) => [+p[0].toFixed(2), +p[1].toFixed(2)]);
sampled.push([sampled[0][0], sampled[0][1]]); // close the loop

writeFileSync(new URL('../src/level/monzaCenterline.json', import.meta.url), JSON.stringify(sampled));

// Report.
const q = sampled.slice(0, -1);
const slope = (q[20][0] - q[2][0]) / (q[20][1] - q[2][1]);
let len = 0;
for (let i = 1; i < sampled.length; i++) len += Math.hypot(sampled[i][0] - sampled[i - 1][0], sampled[i][1] - sampled[i - 1][1]);
console.log(`points ${sampled.length}  lap ${len.toFixed(0)} m (real ${(len * 3).toFixed(0)} m)  straight slope ${slope.toFixed(4)}`);
