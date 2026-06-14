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

  // STEERING HANDEDNESS: reset, accelerate, then steer RIGHT (ArrowRight/KeyD) and check
  // the car's heading rotates toward a right turn and x moves the expected way.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  const headBefore = await page.evaluate(() => {
    const q = (window).__sim.latestSnapshot.chassis.orientation;
    return Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1]));
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200); // build real speed first
  await page.keyboard.down('KeyD'); // steer right
  await page.waitForTimeout(1600);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => {
    const s = (window).__sim.latestSnapshot;
    const q = s.chassis.orientation;
    const yawRate = s.telemetry.yawRate;
    return {
      heading: Math.atan2(2 * (q[0] * q[2] + q[3] * q[1]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])),
      x: s.chassis.position[0], yawRate,
    };
  });
  const dHeading = after.heading - headBefore;
  console.log(`STEER-RIGHT: headingΔ=${dHeading.toFixed(3)} rad  yawRate=${after.yawRate.toFixed(3)}  x=${after.x.toFixed(1)}`);

  // REVERSE: reset (spawns in N), shift down to reverse (Q) while stopped, throttle, and
  // confirm the car moves backward (-Z in its local frame) and the gear reads R.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyQ'); // N -> R
  await page.waitForTimeout(150);
  await page.keyboard.down('KeyW'); // throttle in reverse
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const rev = await page.evaluate(() => {
    const s = (window).__sim.latestSnapshot;
    return { gear: s.telemetry.gear, z: s.chassis.position[2], vz: s.linearVelocity[2], speed: s.telemetry.speedMps };
  });
  console.log(`REVERSE: gear=${rev.gear} (expect -1)  z=${rev.z.toFixed(2)}  vz=${rev.vz.toFixed(2)} (expect <0)  speed=${rev.speed.toFixed(2)}`);

  // PHANTOM-COLLISION watch: accelerate down the main straight on the racing line and
  // sample speed every 100ms. A barrier reaching onto the track shows as a sudden speed
  // DROP with no driver braking. Flag any frame-to-frame loss > 4 m/s.
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyE'); // N -> 1st gear (manual transmission)
  await page.waitForTimeout(100);
  await page.keyboard.down('KeyW');
  let prevSp = 0, worstDrop = 0; const runSpeeds = [];
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(100);
    const sp = await page.evaluate(() => (window).__sim.latestSnapshot.telemetry.speedMps);
    if (i > 3 && prevSp - sp > worstDrop) worstDrop = prevSp - sp;
    prevSp = sp;
    if (i % 9 === 0) runSpeeds.push(sp.toFixed(0));
  }
  await page.keyboard.up('KeyW');
  console.log(`STRAIGHT-RUN speeds(m/s): ${runSpeeds.join(' -> ')}   worst single-frame drop=${worstDrop.toFixed(2)} m/s  (a phantom wall shows as a big unexplained drop)`);
  console.log(`  (a RIGHT turn from +Z forward should swing the car toward -X / a consistent yawRate sign)`);

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
