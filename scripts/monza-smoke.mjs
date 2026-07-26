import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldSpawnServer = process.argv.includes('--spawn-vite');
let vite = null;
let browser = null;

try {
  if (shouldSpawnServer) {
    const parsed = new URL(url);
    vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', parsed.hostname, '--port', parsed.port, '--strictPort'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
    vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  }

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // server still starting
    }
    await sleep(250);
  }
  if (!ready) throw new Error(`Timed out waiting for ${url}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${url}/?e2e=1&debug=1`);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__game?.captureTopDown());
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const info = window.__game?.debugTrackInfo?.();
    return {
      dataUrlPrefix: canvas?.toDataURL('image/png').slice(0, 80),
      info,
    };
  });

  if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
  if (!result.dataUrlPrefix?.startsWith('data:image/png')) throw new Error('canvas readback failed');

  console.log(JSON.stringify({
    ok: true,
    barriers: result.info?.barriers,
    checkpoints: result.info?.checkpoints,
  }));
} finally {
  await browser?.close().catch(() => {});
  if (vite) {
    vite.kill('SIGTERM');
    setTimeout(() => vite && !vite.killed && vite.kill('SIGKILL'), 1500).unref();
  }
}
