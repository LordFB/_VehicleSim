import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:3174';
const vite = spawn(
  process.execPath,
  ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3174', '--strictPort'],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
);
let browser;

try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${url}/?e2e=1&debug=1`);
  await page.getByRole('button', { name: 'Time Trial' }).click();
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 60_000 });
  const hits = await page.evaluate(() => {
    const { camera, renderer, rig, scene, track } = window.MONZA;
    rig.update = () => {};
    const focus = track.cl.at(770);
    const approach = track.cl.at(610);
    camera.position.set(focus.x, focus.y + 190, focus.z);
    camera.up.set(approach.tx, 0, approach.tz);
    camera.fov = 42;
    camera.near = 0.5;
    camera.far = 5000;
    camera.updateProjectionMatrix();
    camera.lookAt(focus.x, focus.y, focus.z);
    renderer.render(scene, camera);
    const raycaster = new THREE.Raycaster();
    const samples = [[500, 300], [650, 300], [760, 300], [900, 300]];
    return samples.map(([x, y]) => {
      raycaster.setFromCamera(
        new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1),
        camera,
      );
      return raycaster.intersectObjects(scene.children, true).slice(0, 4)
        .map((hit) => ({ name: hit.object.name, color: hit.object.material?.color?.getHexString() }));
    });
  });
  console.log(JSON.stringify(hits));
  await page.waitForTimeout(250);
  await page.screenshot({
    path: 'output/iterate/2026-07-28-rettifilo-standalone-corrected.png',
  });
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
