import { spawn } from 'node:child_process';

const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});

vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));

let exitCode = 1;

try {
  await waitForServer('http://127.0.0.1:3000', 20_000);
  exitCode = await runPlaywright();
} finally {
  vite.kill('SIGTERM');
  setTimeout(() => {
    if (!vite.killed) vite.kill('SIGKILL');
  }, 1500).unref();
}

process.exit(exitCode);

async function runPlaywright() {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['./node_modules/@playwright/test/cli.js', 'test'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
