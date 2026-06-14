import { expect, test } from '@playwright/test';

test('app renders a nonblank drivable simulator and telemetry updates', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('.telemetry')).toBeVisible();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await expect(page.locator('.telemetry pre')).toContainText('speed');
  const speedText = await page.locator('.telemetry pre').textContent();
  expect(speedText).toMatch(/km\/h/);
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  const nonBlankPixels = await canvas.evaluate((node) => {
    const canvasNode = node as HTMLCanvasElement;
    const gl = canvasNode.getContext('webgl2') ?? canvasNode.getContext('webgl');
    if (!gl) return 0;
    const pixels = new Uint8Array(4);
    gl.readPixels(Math.floor(canvasNode.width / 2), Math.floor(canvasNode.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels[0] + pixels[1] + pixels[2] + pixels[3];
  });
  expect(nonBlankPixels).toBeGreaterThan(0);
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
