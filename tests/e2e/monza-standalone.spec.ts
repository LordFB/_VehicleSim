import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

type QualityMetrics = {
  lengthM: number;
  reliefM: number;
  seamHeightErrorM: number;
  seamGradeError: number;
  seamBankErrorDeg: number;
  maxGrade: number;
  maxBankSlewDegPerM: number;
  maxRoadEdgeStepM: number;
  maxTerrainSlope: number;
  maxTreeBaseErrorM: number;
  degenerateRoadTriangles: number;
};

async function openStandaloneMonza(page: Page) {
  const threeResponse = await page.request.get('/node_modules/three/build/three.module.js');
  expect(threeResponse.ok()).toBe(true);
  const threeModule = await threeResponse.text();
  await page.route('https://cdn.jsdelivr.net/npm/three@*/build/three.module.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: threeModule,
    });
  });
  await page.goto('/monza.html?e2e=1');
  await page.waitForFunction(
    () => Boolean((window as unknown as { MONZA?: { GameState?: { flags?: { ready?: boolean } } } }).MONZA?.GameState?.flags?.ready),
    null,
    { timeout: 75_000 },
  );
}

test('standalone Monza geometry quality stays within smoothness budgets', async ({ page }) => {
  await openStandaloneMonza(page);
  const metrics = await page.evaluate(() =>
    (window as unknown as { MONZA: { track: { qualityMetrics: () => QualityMetrics } } }).MONZA.track.qualityMetrics(),
  );

  expect(metrics.lengthM).toBeCloseTo(5793, 0);
  expect(metrics.reliefM).toBeGreaterThanOrEqual(12.2);
  expect(metrics.reliefM).toBeLessThanOrEqual(13.2);
  expect(metrics.seamHeightErrorM).toBeLessThan(0.002);
  expect(metrics.seamGradeError).toBeLessThan(0.0005);
  expect(metrics.seamBankErrorDeg).toBeLessThan(0.03);
  expect(metrics.maxGrade).toBeLessThan(0.02);
  expect(metrics.maxBankSlewDegPerM).toBeLessThan(0.1);
  expect(metrics.maxRoadEdgeStepM).toBeLessThan(0.05);
  expect(metrics.maxTerrainSlope).toBeLessThan(0.08);
  expect(metrics.maxTreeBaseErrorM).toBeLessThan(0.03);
  expect(metrics.degenerateRoadTriangles).toBe(0);
});

test('standalone Monza renders its reference-driven detail pass', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openStandaloneMonza(page);

  const details = await page.evaluate(() => {
    const monza = (window as unknown as {
      MONZA: {
        track: { referenceDetails: () => string[] };
        sim: { setVehicleVisible: (visible: boolean) => void };
        scene: { children: unknown[] };
        camera: unknown;
        renderer: {
          render: (scene: unknown, camera: unknown) => void;
          info: { render: { calls: number }; memory: { geometries: number; textures: number } };
        };
      };
    }).MONZA;
    monza.renderer.render(monza.scene, monza.camera);
    const fullCalls = monza.renderer.info.render.calls;
    monza.sim.setVehicleVisible(false);
    monza.renderer.render(monza.scene, monza.camera);
    const result = {
      names: monza.track.referenceDetails(),
      fullCalls,
      calls: monza.renderer.info.render.calls,
      geometries: monza.renderer.info.memory.geometries,
      textures: monza.renderer.info.memory.textures,
    };
    monza.sim.setVehicleVisible(true);
    return result;
  });

  expect(details.names).toEqual(expect.arrayContaining([
    'rettifilo-escape',
    'roggia-bypass',
    'lesmo-woodland',
    'serraglio-bridge',
    'ascari-runoff',
    'alboreto-27',
    'suspended-podium',
    'historic-banking',
  ]));
  expect(details.calls).toBeLessThan(260);
  expect(details.fullCalls).toBeLessThan(310);
  expect(details.geometries).toBeLessThan(220);
  expect(details.textures).toBeLessThan(80);
  expect(errors).toEqual([]);

  await page.evaluate(() => {
    (window as unknown as {
      MONZA: { renderer: { setAnimationLoop: (callback: null) => void } };
    }).MONZA.renderer.setAnimationLoop(null);
  });
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();
  const png = await canvas.screenshot();
  expect(png.byteLength).toBeGreaterThan(80_000);
});

test('standalone Monza boots the Vehicle Sim v0.1 physics runtime', async ({ page }) => {
  await openStandaloneMonza(page);
  await page.waitForFunction(
    () => Boolean((window as unknown as { MONZA?: { sim?: { ready?: boolean } } }).MONZA?.sim?.ready),
    null,
    { timeout: 30_000 },
  );
  const runtime = await page.evaluate(() => {
    const monza = (window as unknown as {
      MONZA: { camera: { position: { toArray: () => number[] } } };
      render_game_to_text: () => string;
    });
    return {
      state: JSON.parse(monza.render_game_to_text()),
      cameraPosition: monza.MONZA.camera.position.toArray(),
    };
  });
  const { state } = runtime;

  expect(state.version).toBe('v0.1');
  expect(state.physics).toBe('Vehicle Sim worker dynamics');
  expect(state.car.ai).toBe(false);
  expect(state.car).toHaveProperty('gear');
  expect(state.car).toHaveProperty('rpm');
  expect(state.effects).toEqual({
    audio: true,
    skidMarks: true,
    tireSmoke: true,
  });
  expect(runtime.cameraPosition.every(Number.isFinite)).toBe(true);

  await page.getByRole('button', { name: /setup/i }).click();
  await expect(page.getByRole('dialog', { name: 'Car setup' })).toBeVisible();
  await expect(page.getByText(/Changes apply live/i)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  const chaseDistances = await page.evaluate(() => {
    const monza = (window as unknown as {
      MONZA: {
        rig: {
          set: (mode: number) => void;
          update: (car: unknown, dt: number) => void;
          pos: { distanceTo: (position: unknown) => number };
        };
      };
    }).MONZA;
    // Use the loaded Three constructor through the real car adapter instead of
    // depending on a global module binding.
    const realCar = (window as unknown as { MONZA: { car: {
      pos: { clone: () => unknown };
      mesh: unknown;
      yaw: number;
    } } }).MONZA.car;
    const makeCar = (speed: number) => ({
      pos: realCar.pos.clone(),
      mesh: realCar.mesh,
      yaw: realCar.yaw,
      speed,
    });
    monza.rig.set(0);
    for (let i = 0; i < 60; i += 1) monza.rig.update(makeCar(0), 1 / 30);
    const atRest = monza.rig.pos.distanceTo(realCar.pos);
    for (let i = 0; i < 60; i += 1) monza.rig.update(makeCar(70), 1 / 30);
    const atSpeed = monza.rig.pos.distanceTo(realCar.pos);
    return { atRest, atSpeed };
  });
  expect(Math.abs(chaseDistances.atRest - chaseDistances.atSpeed)).toBeLessThan(0.05);

  await page.waitForFunction(
    () => JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).car.rpm > 0,
    null,
    { timeout: 20_000 },
  );
  await page.locator('#bAI').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3_000);
  await page.keyboard.up('KeyW');
  const driven = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()),
  );
  expect(driven.car.gear).toBeGreaterThanOrEqual(1);
  expect(driven.car.speedKmh).toBeGreaterThan(1);
});
