// Identify which object actually renders as the car on monza.html.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = process.env.PORT || '4181';
const url = `http://127.0.0.1:${PORT}/monza.html?e2e=1&debug=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, browser;

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
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60_000 });
  await page.evaluate(() => window.advanceTime(300));

  const out = await page.evaluate(() => {
    const carPos = window.MONZA.car.pos;
    const meshInScene = (() => {
      let found = false;
      window.MONZA.scene.traverse((o) => { if (o === window.MONZA.car.mesh) found = true; });
      return found;
    })();
    // Anything with real geometry sitting near the car is a candidate.
    const near = [];
    window.MONZA.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const p = new o.position.constructor();
      o.getWorldPosition(p);
      const d = Math.hypot(p.x - carPos.x, p.z - carPos.z);
      if (d < 4) {
        let path = [];
        for (let n = o; n; n = n.parent) path.unshift(n.name || n.type);
        near.push({ d: +d.toFixed(2), path: path.join('/') });
      }
    });
    near.sort((a, b) => a.d - b.d);
    return {
      carMeshChildren: window.MONZA.car.mesh.children.length,
      carMeshInScene: meshInScene,
      nearCount: near.length,
      sample: near.slice(0, 25),
    };
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
}
