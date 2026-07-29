import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 120_000 });

test('clean root opens the Monza menu before gameplay', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?e2e=1');
  await expect(page.getByRole('heading', { name: 'Monza' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time Trial' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Race', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Participate' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Watch Race' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Restart / Rematch' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Main Menu' })).toBeHidden();
  const state = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()),
  );
  expect(state).toMatchObject({ screen: 'menu', mode: null, race: null });
  expect(await page.evaluate(() => Boolean((window as unknown as { MONZA?: unknown }).MONZA))).toBe(false);
  expect(errors).toEqual([]);
});

test('participate boots a twelve-car standing start from sixth', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Circuit Race' })).toBeVisible();
  await page.getByRole('button', { name: 'Participate' }).click();
  await page.waitForFunction(
    () => {
      const render = (window as unknown as { render_game_to_text?: () => string }).render_game_to_text;
      if (!render) return false;
      const state = JSON.parse(render());
      return state.race?.vehicles?.length === 12;
    },
    null,
    { timeout: 90_000 },
  );
  const state = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()),
  );
  expect(state.mode).toBe('participate');
  expect(state.race.vehicles).toHaveLength(12);
  expect(state.race.vehicles.find((vehicle: { id: string }) => vehicle.id === 'car-6')).toMatchObject({
    ai: false,
    position: 6,
  });
  await page.screenshot({ path: 'output/iterate/2026-07-27-monza-race-grid.png', fullPage: true });
});

test('watch race assigns all twelve cars to AI', async ({ page }) => {
  await page.goto('/?e2e=1');
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await page.getByRole('button', { name: 'Watch Race' }).click();
  await page.waitForFunction(
    () => {
      const render = (window as unknown as { render_game_to_text?: () => string }).render_game_to_text;
      if (!render) return false;
      return JSON.parse(render()).race?.vehicles?.length === 12;
    },
    null,
    { timeout: 90_000 },
  );
  const race = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).race,
  );
  expect(race.mode).toBe('watch');
  expect(race.vehicles.every((vehicle: { ai: boolean }) => vehicle.ai)).toBe(true);
  expect(race.focusedVehicleId).toBe('car-6');
  await page.waitForTimeout(8_000);
  const runningRace = await page.evaluate(() =>
    JSON.parse((window as unknown as { render_game_to_text: () => string }).render_game_to_text()).race,
  );
  expect(runningRace.phase).toBe('running');
  expect(Math.max(...runningRace.vehicles.map(
    (vehicle: { lateralM: number }) => Math.abs(vehicle.lateralM),
  ))).toBeLessThan(4.8);
  await page.screenshot({ path: 'output/iterate/2026-07-27-monza-ai-racing-line.png', fullPage: true });
});
