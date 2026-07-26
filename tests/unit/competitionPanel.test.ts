import { describe, expect, it } from 'vitest';
import {
  loadCompetitionPlayerName,
  saveCompetitionPlayerName,
  type StorageLike,
} from '../../src/ui/CompetitionPanel';

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('competition player profile', () => {
  it('persists a normalized name and refuses invalid names', () => {
    const storage = memoryStorage();
    expect(saveCompetitionPlayerName(storage, '  Max   Power ')).toBe(true);
    expect(loadCompetitionPlayerName(storage)).toBe('Max Power');
    expect(saveCompetitionPlayerName(storage, '<bad>')).toBe(false);
    expect(loadCompetitionPlayerName(storage)).toBe('Max Power');
  });
});
