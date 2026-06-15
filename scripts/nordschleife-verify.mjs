// Visual + behavioural verification for the procedural Nordschleife track.
// Boots Vite, loads /?track=nordschleife, captures start/minimap/drive/top-down
// screenshots, and checks the car remains on the generated asphalt surface.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'scripts/_nordschleife';
mkdirSync(OUT, { recursive: true });

const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3001'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (c) => process.stdout.write(`[vite] ${c}`));
vite.stderr.on('data', (c) => process.stderr.write(`[vite:err] ${c}`));

try {
  await waitFor('http://127.0.0.1:3001', 25000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:3001/?track=nordschleife&e2e=1&debug=1');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/01_startline.png` });
  await page.screenshot({ path: `${OUT}/02_minimap.png`, clip: { x: 980, y: 0, width: 300, height: 220 } });

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(200);
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 18; i += 1) await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${OUT}/03_driving.png` });

  const probe = await page.evaluate(() => {
    const s = window.__sim?.latestSnapshot;
    if (!s) return null;
    return {
      x: s.chassis.position[0].toFixed(1),
      y: s.chassis.position[1].toFixed(1),
      z: s.chassis.position[2].toFixed(1),
      speed: s.telemetry.speedMps.toFixed(1),
      surface: s.telemetry.wheels.frontLeft.surfaceMaterialId,
    };
  });
  console.log('NORDSCHLEIFE PROBE:', JSON.stringify(probe));
  if (!probe || probe.surface !== 'asphalt_new') throw new Error(`Expected asphalt_new under car, got ${probe?.surface}`);
  if (errors.length) throw new Error(`Console errors:\n${errors.join('\n')}`);

  await page.evaluate(() => window.__game.captureTopDown());
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/04_overview.png` });
  await browser.close();
} finally {
  vite.kill('SIGTERM');
  setTimeout(() => !vite.killed && vite.kill('SIGKILL'), 1500).unref();
}

async function waitFor(url, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}
