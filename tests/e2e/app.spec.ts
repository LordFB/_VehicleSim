import { expect, test } from '@playwright/test';

test('app renders a nonblank drivable simulator and telemetry updates', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?e2e=1&debug=1');
  await expect(page.locator('.telemetry')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.telemetry pre')).toContainText('speed');
  const speedText = await page.locator('.telemetry pre').textContent();
  expect(speedText).toMatch(/km\/h/);
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __game?: { captureTopDown: () => void } }).__game?.captureTopDown();
  });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const canvasPng = await page.screenshot({ clip: box! });
  expect(canvasPng.byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test('reset works repeatedly and resize keeps the canvas visible', async ({ page }) => {
  await page.goto('/?e2e=1');
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(150);
  }
  await page.setViewportSize({ width: 900, height: 620 });
  const box = await page.locator('canvas[data-engine]').boundingBox();
  expect(box?.width).toBeGreaterThan(800);
  expect(box?.height).toBeGreaterThan(500);
});

test('car setup modal remains operable after TrackPrint UI styling', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: /setup/i }).click();
  await expect(page.getByRole('dialog', { name: 'Car setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tuning' })).toHaveClass(/is-active/);
  await expect(page.getByText('Tire grip')).toBeVisible();
  await page.getByRole('button', { name: 'Transmission' }).click();
  await expect(page.getByRole('button', { name: /manual|automatic/i })).toBeVisible();
  await page.getByRole('button', { name: 'Assists' }).click();
  await expect(page.getByText('Electronic aids')).toBeVisible();
});

test('nordschleife track renders and exposes asphalt contact', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?track=nordschleife&e2e=1&debug=1');
  await expect(page.locator('.telemetry')).toBeVisible();
  await page.waitForTimeout(900);
  const probe = await page.evaluate(() => {
    const snapshot = (window as unknown as { __sim?: { latestSnapshot?: { telemetry: { wheels: { frontLeft: { surfaceMaterialId: string } } } } } }).__sim?.latestSnapshot;
    return snapshot?.telemetry.wheels.frontLeft.surfaceMaterialId ?? null;
  });
  expect(probe).toBe('asphalt_new');
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __game?: { captureTopDown: () => void } }).__game?.captureTopDown();
  });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const canvasPng = await page.screenshot({ clip: box! });
  expect(canvasPng.byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});

test('track editor route renders TrackPrint without booting the driving simulator', async ({ page }) => {
  await page.goto('/track-editor?e2e=1');
  await expect(page.getByRole('main')).toHaveClass(/trackprint-editor/);
  await expect(page.getByRole('heading', { name: /trackprint/i })).toBeVisible();
  await expect(page.locator('.telemetry')).toHaveCount(0);
  await expect(page.locator('canvas[data-engine]')).toHaveCount(0);
});

test('a wall authored in the editor reaches the sim as a collidable barrier', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/track-editor?e2e=1&debug=1');

  // Select the Walls tool and draw a free-form wall: start, click a few points
  // in the viewport, finish — the real authoring path, not an injected document.
  await page.getByRole('button', { name: 'Tool Walls' }).click();
  await page.getByRole('button', { name: 'New wall' }).click();
  const viewport = page.getByTestId('track-viewport');
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.click(cx - 80, cy - 40);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 80, cy + 40);
  await page.getByRole('button', { name: 'Finish wall' }).click();
  // The new wall appears in the list with its point count.
  await expect(page.getByText(/^Wall wall-1/)).toBeVisible();

  // Race the edited track and confirm the loaded sim world carries barriers
  // (it was hardcoded to none before this work).
  await page.getByRole('button', { name: 'Race edited track in simulator' }).click();
  await page.waitForURL(/track=trackprint/);
  // Wait for the sim to boot and expose its debug accessor, then confirm the
  // loaded world carries the wall's barriers (it was hardcoded to none before).
  await page.waitForFunction(
    () => Boolean((window as unknown as { __game?: { debugTrackInfo: () => unknown } }).__game),
    null,
    { timeout: 15_000 },
  );
  const info = await page.evaluate(() =>
    (window as unknown as { __game?: { debugTrackInfo: () => { barriers: number; checkpoints: number } } }).__game!.debugTrackInfo(),
  );
  expect(info.barriers).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('track editor launches the simulator on the edited TrackPrint track', async ({ page }) => {
  await page.goto('/track-editor?e2e=1&debug=1');
  await page.getByRole('button', { name: 'Race edited track in simulator' }).click();
  await page.waitForURL(/track=trackprint/);
  await expect(page.locator('.telemetry')).toBeVisible();
  const trackName = await page.locator('.status').textContent();
  expect(trackName).toContain('TrackPrint');
  const material = await page.evaluate(() => {
    const snapshot = (window as unknown as { __sim?: { latestSnapshot?: { telemetry: { wheels: { frontLeft: { surfaceMaterialId: string } } } } } }).__sim?.latestSnapshot;
    return snapshot?.telemetry.wheels.frontLeft.surfaceMaterialId ?? null;
  });
  expect(material).toBe('asphalt_new');
});
