import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4176/monza.html?e2e=1&debug=1';
const screenshot = 'output/iterate/2026-07-26-onboard-enhanced.png';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let browser;

try {
  server = spawn(
    process.execPath,
    ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4176', '--strictPort'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  server.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // Vite is still starting.
    }
    if (attempt === 79) throw new Error(`Timed out waiting for ${url}`);
    await sleep(250);
  }

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.MONZA?.sim?.ready, null, { timeout: 30_000 });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).camera === 'COCKPIT');
  await page.evaluate(() => window.advanceTime(250));
  await page.screenshot({ path: screenshot });

  const probe = await page.evaluate(() => {
    const names = [];
    window.MONZA.scene.traverse((object) => {
      if (object.name.startsWith('cockpit-')) names.push(object.name);
    });
    return {
      state: JSON.parse(window.render_game_to_text()),
      names,
      render: window.MONZA.renderer.info.render,
    };
  });
  if (errors.length) throw new Error(`Console errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({ screenshot, ...probe }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  server?.kill('SIGTERM');
}
