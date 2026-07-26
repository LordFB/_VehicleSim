import { describe, expect, it } from 'vitest';
import {
  CompetitionLapController,
  type WheelTrackContact,
} from '../../src/game/CompetitionLap';

const legal = (surfaceMaterialId: 'asphalt_new' | 'kerb' = 'asphalt_new'): WheelTrackContact => ({
  contact: true,
  surfaceMaterialId,
});

const illegal = (surfaceMaterialId: 'grass' | 'gravel' = 'grass'): WheelTrackContact => ({
  contact: true,
  surfaceMaterialId,
});

describe('competition lap race control', () => {
  it('invalidates only when all four contacting wheels are off the legal surface', () => {
    const lap = new CompetitionLapController(1000, 100, 0);

    expect(lap.update(100, 20, [illegal(), illegal(), illegal(), legal('kerb')]).valid).toBe(true);
    expect(lap.update(110, 30, [illegal(), illegal(), illegal(), { ...illegal(), contact: false }]).valid).toBe(true);

    const state = lap.update(120, 40, [
      illegal('grass'),
      illegal('gravel'),
      illegal('grass'),
      illegal('gravel'),
    ]);

    expect(state.valid).toBe(false);
    expect(state.invalidReason).toBe('four_wheels_off_track');
  });

  it('invalidates on reset and cannot bank a reset-assisted line wrap', () => {
    const lap = new CompetitionLapController(1000, 100, 0);
    lap.update(900, 150, [legal(), legal(), legal(), legal()]);
    lap.invalidate('reset');

    const state = lap.update(10, 160, [legal(), legal(), legal(), legal()]);

    expect(state.justDiscarded).toBe(true);
    expect(state.justCompleted).toBe(false);
    expect(state.lastMs).toBeNull();
    expect(state.bestMs).toBeNull();
    expect(state.lapNumber).toBe(2);
  });

  it('starts clean after discarding an invalid lap and banks the next valid lap', () => {
    const lap = new CompetitionLapController(1000, 100, 0);
    lap.update(900, 120);
    lap.invalidate('four_wheels_off_track');
    lap.update(10, 130);

    expect(lap.snapshot().valid).toBe(true);
    expect(lap.snapshot().invalidReason).toBeNull();

    lap.update(900, 260, [legal(), legal(), legal(), legal()]);
    const completed = lap.update(10, 280, [legal(), legal(), legal(), legal()]);

    expect(completed.justCompleted).toBe(true);
    expect(completed.justDiscarded).toBe(false);
    expect(completed.lastMs).toBe(150);
    expect(completed.bestMs).toBe(150);
    expect(completed.lapNumber).toBe(3);
  });
});
