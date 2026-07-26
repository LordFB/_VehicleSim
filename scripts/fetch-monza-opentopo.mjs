import { readFileSync, writeFileSync } from 'node:fs';

const env = readEnv();
const apiKey =
  env.opentopokey ||
  env.OPENTOPOGRAPHY_API_KEY ||
  env.OPEN_TOPOGRAPHY_API_KEY ||
  env.OPENTOPO_API_KEY;

if (!apiKey) {
  throw new Error('Missing OpenTopography key. Expected opentopokey or OPENTOPOGRAPHY_API_KEY in .env.');
}

const source = readFileSync(new URL('./gen-monza-centerline.mjs', import.meta.url), 'utf8');
const coords = Function(`return ${source.match(/const COORDS = (\[[\s\S]*?\]);/)?.[1] ?? '[]'}`)();
if (!Array.isArray(coords) || coords.length === 0) throw new Error('Could not read Monza COORDS.');

const west = Math.min(...coords.map((p) => p[0])) - 0.004;
const east = Math.max(...coords.map((p) => p[0])) + 0.004;
const south = Math.min(...coords.map((p) => p[1])) - 0.004;
const north = Math.max(...coords.map((p) => p[1])) + 0.004;
const url =
  `https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1` +
  `&south=${south}&north=${north}&west=${west}&east=${east}` +
  `&outputFormat=AAIGrid&API_Key=${encodeURIComponent(apiKey)}`;

console.log(`Fetching OpenTopography SRTMGL1 AAIGrid for Monza bbox ${west.toFixed(5)},${south.toFixed(5)} -> ${east.toFixed(5)},${north.toFixed(5)}`);
const response = await fetch(url);
const text = await response.text();
if (!response.ok) {
  throw new Error(`OpenTopography request failed (${response.status} ${response.statusText}): ${text.slice(0, 300)}`);
}

const grid = parseAsciiGrid(text);
const stations = cumulativeStations(coords);
const pick = [];
for (let i = 0; i < coords.length; i += 2) pick.push(i);
if (pick[pick.length - 1] !== coords.length - 1) pick.push(coords.length - 1);

const controls = pick.map((index) => {
  const [lon, lat] = coords[index];
  return {
    realS: round(stations[index], 1),
    elevation: round(sampleAscii(grid, lon, lat), 2),
  };
});

const out = {
  source: 'OpenTopography SRTMGL1 30m',
  fetched: new Date().toISOString().slice(0, 10),
  controls,
};

writeFileSync(new URL('../src/level/monzaElevation.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${controls.length} controls. Elevation range ${Math.min(...controls.map((c) => c.elevation))}-${Math.max(...controls.map((c) => c.elevation))} m.`);

function readEnv() {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const idx = line.indexOf('=');
    vars[line.slice(0, idx)] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return vars;
}

function parseAsciiGrid(text) {
  const tokens = text.trim().split(/\s+/);
  const header = {};
  let i = 0;
  while (i + 1 < tokens.length && Number.isNaN(Number(tokens[i]))) {
    header[tokens[i].toLowerCase()] = Number(tokens[i + 1]);
    i += 2;
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  if (!Number.isFinite(ncols) || !Number.isFinite(nrows)) throw new Error('AAIGrid missing ncols/nrows.');
  const values = new Array(ncols * nrows);
  for (let v = 0; v < values.length; v += 1) values[v] = Number(tokens[i + v]);
  return {
    ncols,
    nrows,
    xllcorner: header.xllcorner ?? 0,
    yllcorner: header.yllcorner ?? 0,
    cellsize: header.cellsize ?? 0,
    nodata: header.nodata_value ?? -9999,
    values,
  };
}

function sampleAscii(grid, lon, lat) {
  const fx = (lon - grid.xllcorner) / grid.cellsize;
  const fyFromSouth = (lat - grid.yllcorner) / grid.cellsize;
  const fy = grid.nrows - 1 - fyFromSouth;
  const x0 = clamp(Math.floor(fx), 0, grid.ncols - 1);
  const y0 = clamp(Math.floor(fy), 0, grid.nrows - 1);
  const x1 = Math.min(grid.ncols - 1, x0 + 1);
  const y1 = Math.min(grid.nrows - 1, y0 + 1);
  const tx = clamp(fx - x0, 0, 1);
  const ty = clamp(fy - y0, 0, 1);
  const at = (x, y) => {
    const value = grid.values[y * grid.ncols + x];
    return value === grid.nodata ? 0 : value;
  };
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

function cumulativeStations(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) out[i] = out[i - 1] + distanceMeters(points[i - 1], points[i]);
  return out;
}

function distanceMeters(a, b) {
  const radius = 6378137;
  const d2r = Math.PI / 180;
  const lat = (a[1] + b[1]) * 0.5 * d2r;
  return Math.hypot((b[0] - a[0]) * d2r * radius * Math.cos(lat), (b[1] - a[1]) * d2r * radius);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}
