import { describe, expect, it } from 'vitest';
import {
  parseLapSubmission,
  normalizePlayerName,
} from '../../src/competition/LeaderboardContract';

describe('leaderboard contract', () => {
  it('normalizes safe player names and rejects unsafe or malformed names', () => {
    expect(normalizePlayerName('  Max   Power  ')).toBe('Max Power');
    expect(normalizePlayerName('Åsa_27')).toBe('Åsa_27');
    expect(normalizePlayerName('ab')).toBeNull();
    expect(normalizePlayerName('driver<script>')).toBeNull();
    expect(normalizePlayerName('x'.repeat(25))).toBeNull();
  });

  it('accepts only valid Monza v0.1 competition laps in plausible bounds', () => {
    expect(parseLapSubmission({
      playerName: 'Max Power',
      trackId: 'monza-gp',
      lapMs: 98_432,
      build: 'v0.1',
      ruleset: 'monza-gp-v1',
      integrity: { valid: true, invalidReason: null },
    })).toEqual({
      playerName: 'Max Power',
      trackId: 'monza-gp',
      lapMs: 98_432,
      build: 'v0.1',
      ruleset: 'monza-gp-v1',
      integrity: { valid: true, invalidReason: null },
    });

    for (const invalid of [
      { lapMs: 12_000 },
      { lapMs: 700_000 },
      { trackId: 'nordschleife' },
      { build: 'v0.0' },
      { ruleset: 'anything-goes' },
      { integrity: { valid: false, invalidReason: 'reset' } },
    ]) {
      expect(parseLapSubmission({
        playerName: 'Max Power',
        trackId: 'monza-gp',
        lapMs: 98_432,
        build: 'v0.1',
        ruleset: 'monza-gp-v1',
        integrity: { valid: true, invalidReason: null },
        ...invalid,
      })).toBeNull();
    }
  });
});
