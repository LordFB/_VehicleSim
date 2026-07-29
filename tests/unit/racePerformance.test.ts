import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { RaceRuntime } from '../../src/race/RaceRuntime';
import { createTestRaceSpec } from './support/raceFixtures';

it('advances a representative twelve-car race faster than real time', () => {
  const runtime = new RaceRuntime(createTestRaceSpec('watch'));
  const started = performance.now();
  for (let frame = 0; frame < 3_600; frame += 1) runtime.step(1000 / 60);
  const elapsed = performance.now() - started;
  expect(runtime.snapshot().simTimeMs).toBeGreaterThanOrEqual(59_900);
  expect(elapsed).toBeLessThan(5_000);
});
