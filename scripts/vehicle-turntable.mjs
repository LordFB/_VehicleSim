// Photograph the vehicle mesh from several angles by driving window.MONZA directly.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = process.env.PORT || '4177';
const url = `http://127.0.0.1:${PORT}/monza.html?e2e=1&debug=1`;
const outDir = process.env.OUT || 'output/iterate/vehicle';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser;

const SHOTS = [
  ['front-3q', 4.2, 1.5, 5.2],
  ['side', 6.5, 1.1, 0.2],
  ['rear-3q', -4.4, 1.6, -5.0],
  ['front', 0.2, 1.0, 6.4],
  ['top', 0.2, 6.0, 2.2],
  ['low-front', 2.6, 0.35, 4.2],
];

try {
  server = spawn(
    process.execPath,
    ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', PORT, '--strictPort'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stderr.on('data', (c) => process.stderr.write(`[vite] ${c}`));

  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 99) throw new Error(`timeout waiting for ${url}`);
    await sleep(250);
  }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60_000 });
  await page.evaluate(() => window.advanceTime(400));

  // Force the external car mesh visible regardless of camera mode.
  const info = await page.evaluate(() => {
    const sim = window.MONZA.sim;
    // Stop the sim's own loop so it cannot overwrite our camera each frame.
    window.MONZA.renderer.setAnimationLoop(null);
    for (const el of document.querySelectorAll('body > *:not(canvas)')) {
      if (el.tagName !== 'SCRIPT') el.style.display = 'none';
    }
    // The rendered car is VehicleView's group (makeCarModel() in monza.html is
    // dead code and never added to the scene).
    let vehicle = null;
    let cockpit = null;
    window.MONZA.scene.traverse((o) => {
      if (o.name === 'vehicle-view') vehicle = o;
      if (o.name === 'cockpit-wheel-view') cockpit = o;
    });
    if (!vehicle) return { found: false };
    // Show the external bodywork exactly as an outside camera would: chassis on,
    // cockpit-only view off. Forcing every object visible would composite the
    // steering wheel and dashboard on top of the car.
    if (sim.setCameraMode) sim.setCameraMode('NOSE');
    vehicle.visible = true;
    const chassis = vehicle.getObjectByName('vehicle-chassis');
    if (chassis) chassis.visible = true;
    if (cockpit) cockpit.visible = false;
    window.__vehicle = vehicle;
    return { found: true, meshes: vehicle.children.length, cockpitHidden: !!cockpit };
  });
  console.log(JSON.stringify(info, null, 2));

  for (const [name, x, y, z] of SHOTS) {
    await page.evaluate(([x, y, z]) => {
      const v = window.__vehicle;
      const cam = window.MONZA.camera;
      const c = v.getObjectByName('vehicle-chassis') || v;
      c.updateWorldMatrix(true, false);
      const e = c.matrixWorld.elements;
      const o = { x: e[12], y: e[13], z: e[14] };
      // Offsets are in the car's own frame so the angles stay consistent
      // regardless of where on the circuit the car is sitting.
      const yaw = window.MONZA.car.yaw || 0;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      cam.position.set(o.x + (x * cs + z * sn), o.y + y, o.z + (z * cs - x * sn));
      cam.lookAt(o.x, o.y + 0.1, o.z);
      cam.fov = 40;
      cam.near = 0.05;
      cam.updateProjectionMatrix();
      window.MONZA.renderer.render(window.MONZA.scene, cam);
    }, [x, y, z]);
    await page.screenshot({ path: `${outDir}/${name}.png` });
  }

  if (errors.length) console.log('ERRORS: ' + errors.join(' | '));
  console.log('done ->', outDir);
} finally {
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
}
