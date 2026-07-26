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
  test.setTimeout(160_000);
  const leaderboardEntries = [{
    id: 'alice-lap',
    playerName: 'Alice',
    normalizedPlayerName: 'alice',
    trackId: 'monza-gp',
    lapMs: 99_500,
    build: 'v0.1',
    ruleset: 'monza-gp-v1',
    submittedAt: '2026-07-27T10:00:00.000Z',
    verification: 'client-integrity',
    rank: 1,
  }];
  let leaderboardPosts = 0;
  await page.route('**/api/leaderboard*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      leaderboardPosts += 1;
      const submission = request.postDataJSON() as { playerName: string; lapMs: number };
      const accepted = {
        ...leaderboardEntries[0],
        id: 'max-lap',
        playerName: submission.playerName,
        normalizedPlayerName: submission.playerName.toLowerCase(),
        lapMs: submission.lapMs,
      };
      leaderboardEntries.push(accepted);
      await route.fulfill({ status: 201, json: { entry: accepted } });
      return;
    }
    const ranked = [...leaderboardEntries]
      .sort((a, b) => a.lapMs - b.lapMs)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
    await route.fulfill({ status: 200, json: { trackId: 'monza-gp', entries: ranked } });
  });
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

  await page.getByRole('button', { name: 'Competition' }).click();
  await expect(page.getByRole('dialog', { name: 'Monza Competition' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alice.*1:39.500.*Client/i })).toBeVisible();
  await page.getByLabel('Driver name').fill('  Max   Power  ');
  await page.getByRole('button', { name: 'Save driver' }).click();
  await page.evaluate(async () => {
    const panel = (window as unknown as {
      MONZA: {
        competitionPanel: {
          submitCompletedLap: (lap: {
            lapNumber: number;
            currentMs: number;
            lastMs: number;
            bestMs: number;
            valid: boolean;
            invalidReason: null;
            justCompleted: boolean;
            justDiscarded: boolean;
          }) => Promise<void>;
        };
      };
    }).MONZA.competitionPanel;
    await panel.submitCompletedLap({
      lapNumber: 2,
      currentMs: 0,
      lastMs: 98_432,
      bestMs: 98_432,
      valid: true,
      invalidReason: null,
      justCompleted: true,
      justDiscarded: false,
    });
  });
  await expect(page.getByRole('row', { name: /Max Power.*1:38.432.*Client/i })).toBeVisible();
  expect(leaderboardPosts).toBe(1);
  await page.evaluate(async () => {
    const panel = (window as unknown as {
      MONZA: {
        competitionPanel: {
          submitCompletedLap: (lap: {
            lapNumber: number;
            currentMs: number;
            lastMs: number;
            bestMs: number;
            valid: boolean;
            invalidReason: string;
            justCompleted: boolean;
            justDiscarded: boolean;
          }) => Promise<void>;
        };
      };
    }).MONZA.competitionPanel;
    await panel.submitCompletedLap({
      lapNumber: 3,
      currentMs: 0,
      lastMs: 12_000,
      bestMs: 12_000,
      valid: false,
      invalidReason: 'reset',
      justCompleted: true,
      justDiscarded: false,
    });
  });
  expect(leaderboardPosts).toBe(1);
  const leaderboardState = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).leaderboard,
  );
  expect(leaderboardState).toMatchObject({
    playerName: 'Max Power',
    status: 'ready',
    entries: 2,
    open: true,
  });
  await page.screenshot({
    path: 'output/iterate/2026-07-27-netlify-leaderboard.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close competition' }).click();

  const cameraModes = await page.evaluate(() => {
    const monza = (window as unknown as {
      MONZA: {
        rig: {
          cycle: () => string;
        };
      };
    }).MONZA;
    const initial = JSON.parse(
      (window as unknown as { render_game_to_text: () => string }).render_game_to_text(),
    ).camera;
    const cycled = Array.from({ length: 8 }, () => monza.rig.cycle());
    return { initial, cycled };
  });
  expect(cameraModes.initial).toBe('COCKPIT');
  expect(cameraModes.cycled).not.toContain('CHASE');

  await page.waitForFunction(
    () => JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).car.rpm > 0,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    const sim = (window as unknown as {
      MONZA: {
        sim: {
          isAutoShift: () => boolean;
          toggleTransmission: () => boolean;
        };
      };
    }).MONZA.sim;
    if (!sim.isAutoShift()) sim.toggleTransmission();
  });
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    () => JSON.parse(
      (window as unknown as { render_game_to_text: () => string }).render_game_to_text(),
    ).car.speedKmh > 1,
    null,
    { timeout: 20_000 },
  );
  await page.keyboard.up('KeyW');
  const driven = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()),
  );
  expect(driven.car.gear).toBeGreaterThanOrEqual(1);
  expect(driven.car.speedKmh).toBeGreaterThan(1);

  await page.keyboard.press('KeyR');
  await expect(page.locator('#lapStatus')).toHaveText(/Invalid · reset/i);
  const resetCompetition = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).competition,
  );
  expect(resetCompetition.valid).toBe(false);
  expect(resetCompetition.invalidReason).toBe('reset');
  expect(resetCompetition.lastMs).toBe(driven.competition.lastMs);
  expect(resetCompetition.bestMs).toBe(driven.competition.bestMs);
  await page.screenshot({
    path: 'output/iterate/2026-07-26-competition-reset-invalid.png',
    fullPage: true,
  });
});
