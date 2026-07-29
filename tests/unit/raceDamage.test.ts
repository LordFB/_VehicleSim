import { describe, expect, it } from 'vitest';
import {
  applyRaceImpact,
  createPristineDamageState,
  damageEffects,
  type RaceImpact,
} from '../../src/race/DamageModel';

const impact = (overrides: Partial<RaceImpact> = {}): RaceImpact => ({
  source: 'barrier',
  deltaSpeedMps: 22,
  localX: 0,
  localZ: 1,
  timeMs: 1_000,
  ...overrides,
});

describe('race damage', () => {
  it('ignores rubbing contact and deterministically localizes meaningful impacts', () => {
    const pristine = createPristineDamageState();
    expect(applyRaceImpact(pristine, impact({ deltaSpeedMps: 3 }))).toEqual(pristine);

    const first = applyRaceImpact(pristine, impact());
    const replay = applyRaceImpact(createPristineDamageState(), impact());
    expect(first).toEqual(replay);
    expect(first.health.frontWing).toBeLessThan(first.health.rearWing);
    expect(first.health.frontLeftSuspension).toBeLessThan(1);
    expect(first.lastImpact).toMatchObject({ source: 'barrier', component: 'frontWing' });
  });

  it('damages the struck side and converts accumulated damage into physical consequences', () => {
    let state = createPristineDamageState();
    state = applyRaceImpact(state, impact({ deltaSpeedMps: 34, localX: 1, localZ: 0 }));
    state = applyRaceImpact(state, impact({ deltaSpeedMps: 34, localX: 1, localZ: 0, timeMs: 2_000 }));
    state = applyRaceImpact(state, impact({ deltaSpeedMps: 30, localX: 0, localZ: -1, timeMs: 3_000 }));
    const effects = damageEffects(state);

    expect(state.health.frontRightSuspension).toBeLessThan(state.health.frontLeftSuspension);
    expect(state.punctures).toContain('frontRight');
    expect(effects.wheelGripScale.frontRight).toBeLessThan(0.25);
    expect(Math.abs(effects.steeringBias)).toBeGreaterThan(0.02);
    expect(effects.powerScale).toBeLessThan(1);
    expect(effects.downforceScale).toBeLessThan(1);
    expect(effects.dragScale).toBeGreaterThan(1);
  });

  it('retires a critically damaged car without random failure rolls', () => {
    let state = createPristineDamageState();
    for (let hit = 0; hit < 5; hit += 1) {
      state = applyRaceImpact(state, impact({
        deltaSpeedMps: 42,
        localX: 0,
        localZ: -1,
        timeMs: hit * 500,
      }));
    }
    expect(state.retired).toBe(true);
    expect(damageEffects(state).retired).toBe(true);
  });
});
