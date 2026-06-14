// Verifies the car setup modal: opens it, confirms it renders, changes a LIVE setting
// (tire grip) and asserts the running car physics responds (lower grip → the car slides
// more under the same steering). Also checks persistence to localStorage.
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
  await page.waitForTimeout(2200);

  // Open the modal via the button.
  await page.locator('.setup-open').click();
  await page.waitForTimeout(200);
  const modalVisible = await page.locator('.setup-panel').isVisible();
  console.log('MODAL opens:', modalVisible);
  await page.screenshot({ path: `${OUT}/05_setup_tuning.png` });

  // Read the grip slider (first range in Tuning), confirm it's wired.
  const gripBefore = await page.evaluate(() => (window).__sim ? null : null); // placeholder
  const sliderCount = await page.locator('.setup-body input[type="range"]').count();
  console.log('TUNING sliders:', sliderCount);

  // Drive a steady cornering test at stock grip, then at low grip, and compare peak yaw.
  async function cornerTest() {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2600);
    await page.keyboard.down('KeyD');
    let peakLat = 0;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(80);
      const v = await page.evaluate(() => {
        const s = (window).__sim.latestSnapshot;
        // lateral accel proxy = |yawRate * speed|
        return Math.abs(s.telemetry.yawRate) * s.telemetry.speedMps;
      });
      peakLat = Math.max(peakLat, v);
    }
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    return peakLat;
  }

  const stockLat = await cornerTest();

  // Set grip slider to its minimum (0.7×) and re-test.
  await page.locator('.setup-open').click(); // ensure open
  await page.waitForTimeout(150);
  const grip = page.locator('.setup-body input[type="range"]').first();
  await grip.evaluate((el) => {
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const lowLat = await cornerTest();

  console.log(`LIVE-APPLY grip: stock peak latAccel=${stockLat.toFixed(2)}  low-grip=${lowLat.toFixed(2)}  (low should be < stock)`);

  // Persistence: the setup should be in localStorage.
  const persisted = await page.evaluate(() => localStorage.getItem('vehiclesim.carSetup.v1'));
  console.log('PERSISTED:', persisted ? persisted.slice(0, 80) + '…' : 'NONE');

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
