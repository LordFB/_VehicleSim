// Visual + behavioural verification of the Monza rebuild. Boots the dev server,
// loads the app, injects a top-down debug camera to photograph the whole circuit,
// grabs the in-car view + HUD minimap, then drives the car forward to confirm it
// stays on the asphalt ribbon. Screenshots land in scripts/_monza/.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'scripts/_monza';
mkdirSync(OUT, { recursive: true });

const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3000'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
});
vite.stdout.on('data', (c) => process.stdout.write(`[vite] ${c}`));

try {
  await waitFor('http://127.0.0.1:3000', 25000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });
  await page.goto('http://127.0.0.1:3000/?e2e=1&debug=1');
  await page.waitForTimeout(2500);

  // In-car view at the start line.
  await page.screenshot({ path: `${OUT}/01_startline.png` });

  // HUD minimap crop (top-right) — should read as the Monza silhouette.
  await page.screenshot({ path: `${OUT}/02_minimap_full.png`, clip: { x: 980, y: 0, width: 300, height: 220 } });

  // Drive forward ~4 s and sample telemetry + position to confirm it stays on track.
  await page.keyboard.down('KeyW');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    const t = await page.locator('.telemetry pre').textContent().catch(() => '');
    samples.push(t?.split('\n').slice(0, 3).join(' | '));
  }
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${OUT}/03_driving.png` });
  await page.screenshot({ path: `${OUT}/04_minimap_driving.png`, clip: { x: 980, y: 0, width: 300, height: 220 } });

  // Surface material under the car (confirms it's on asphalt, not grass) + position.
  const probe = await page.evaluate(() => {
    const s = (window).__sim?.latestSnapshot;
    if (!s) return null;
    const fl = s.telemetry.wheels.frontLeft;
    return { x: s.chassis.position[0].toFixed(1), z: s.chassis.position[2].toFixed(1), surf: fl.surfaceMaterialId };
  });

  console.log('TELEMETRY SAMPLES:');
  samples.forEach((s, i) => console.log(`  t=${(i + 1) * 0.5}s  ${s}`));
  console.log('PROBE after drive:', JSON.stringify(probe));

  // Top-down overview of the whole circuit via the debug hook (freezes the loop last).
  await page.evaluate(() => (window).__game.captureTopDown());
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/02_overview.png` });

  await browser.close();
} finally {
  vite.kill('SIGTERM');
  setTimeout(() => !vite.killed && vite.kill('SIGKILL'), 1500).unref();
}

async function waitFor(url, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}
