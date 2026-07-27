// Drive the car and capture every in-game camera, so the vehicle is verified in
// motion on the real cameras rather than in a frozen scene.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = process.env.PORT || '4179';
const url = `http://127.0.0.1:${PORT}/monza.html?e2e=1&debug=1`;
const outDir = process.env.OUT || 'output/iterate/vehicle-drive';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser;

// Physics runs in a Web Worker, so the synchronous advanceTime() stepper cannot
// drive it. Hold the keys down over real wall-clock time and let the page's own
// rAF loop tick the sim, exactly as it does for a human driver.
const drive = async (page, codes, ms) => {
  await page.evaluate(
    (codes) => {
      for (const c of codes) window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    },
    codes,
  );
  await sleep(ms);
  await page.evaluate(
    (codes) => {
      for (const c of codes) window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    },
    codes,
  );
};

const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text()));

try {
  server = spawn(
    process.execPath,
    ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', PORT, '--strictPort'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stderr.on('data', (c) => process.stderr.write(`[vite] ${c}`));
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 99) throw new Error('timeout');
    await sleep(250);
  }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60_000 });
  await sleep(600);
  // Hide the HUD so the shots show the car, not the overlays.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body > *:not(canvas)')) {
      if (el.tagName !== 'SCRIPT') el.style.display = 'none';
    }
  });

  // Transmission starts in neutral, so select first before applying throttle,
  // otherwise the engine just revs and the car never moves.
  await page.keyboard.press('e');
  await sleep(150);

  // Get up to speed down the main straight, shifting up as the revs climb.
  await drive(page, ['KeyW'], 2500);
  for (let g = 0; g < 5; g += 1) {
    await page.keyboard.press('e');
    await drive(page, ['KeyW'], 2200);
  }
  const moving = await state(page);

  // Walk every camera mode, holding throttle + a little steering so the car is
  // in motion and slightly yawed in each shot.
  const modes = ['COCKPIT', 'NOSE', 'TV', 'HELICOPTER', 'ORBIT'];
  const seen = [];
  for (let i = 0; i < modes.length; i += 1) {
    const current = await page.evaluate(() => window.MONZA.rig.mode);
    const label = modes[current] ?? String(current);
    // Throttle only: constant steering lock would put the car in the grass.
    await drive(page, ['KeyW'], 900);
    await page.screenshot({ path: `${outDir}/cam-${String(i).padStart(2, '0')}-${label}.png` });
    seen.push({ label, kmh: +(await state(page)).car.speedKmh.toFixed(1) });
    await page.evaluate(() => window.MONZA.rig.cycle());
  }

  // Hard braking from speed, to confirm the discs light up.
  await drive(page, ['KeyW'], 3000);
  await drive(page, ['KeyS'], 700);
  await page.screenshot({ path: `${outDir}/braking.png` });

  console.log(JSON.stringify({ topSpeedKmh: +moving.car.speedKmh.toFixed(1), seen, errors }, null, 1));
} finally {
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
}
