import { describe, expect, it } from 'vitest';
import {
  handleLeaderboardRequest,
  type LeaderboardStore,
} from '../../netlify/lib/leaderboard';
import type { LeaderboardEntry } from '../../src/competition/LeaderboardContract';
import { createBlobLeaderboardStore } from '../../netlify/lib/blobLeaderboardStore';

function memoryStore(seed: LeaderboardEntry[] = []): LeaderboardStore & { saved: LeaderboardEntry[] } {
  const saved = [...seed];
  return {
    saved,
    save: async (entry) => { saved.push(entry); },
    list: async (trackId) => saved.filter((entry) => entry.trackId === trackId),
  };
}

const entry = (overrides: Partial<LeaderboardEntry>): LeaderboardEntry => ({
  id: 'lap-1',
  playerName: 'Alice',
  normalizedPlayerName: 'alice',
  trackId: 'monza-gp',
  lapMs: 100_000,
  build: 'v0.1',
  ruleset: 'monza-gp-v1',
  submittedAt: '2026-07-27T10:00:00.000Z',
  verification: 'client-integrity',
  ...overrides,
});

describe('Netlify leaderboard handler', () => {
  it('uses immutable unique Blob keys and a track-scoped listing prefix', async () => {
    const writes: Array<{ key: string; value: unknown; options: unknown }> = [];
    const stored = entry({ id: '12345678-1234-1234-1234-123456789abc', lapMs: 98_432 });
    const blobs = {
      setJSON: async (key: string, value: unknown, options: unknown) => {
        writes.push({ key, value, options });
      },
      list: async (options?: { prefix?: string }) => {
        expect(options).toEqual({ prefix: 'monza-gp/' });
        return { blobs: [{ key: 'monza-gp/000098432/123' }] };
      },
      get: async () => stored,
    };
    const store = createBlobLeaderboardStore(blobs);

    await store.save(stored);
    expect(writes).toEqual([{
      key: 'monza-gp/000098432/12345678-1234-1234-1234-123456789abc',
      value: stored,
      options: { onlyIfNew: true },
    }]);
    await expect(store.list('monza-gp')).resolves.toEqual([stored]);
  });

  it('ranks one best result per case-insensitive driver', async () => {
    const store = memoryStore([
      entry({ id: 'a1', playerName: 'Alice', normalizedPlayerName: 'alice', lapMs: 101_000 }),
      entry({ id: 'a2', playerName: 'ALICE', normalizedPlayerName: 'alice', lapMs: 99_000 }),
      entry({ id: 'b1', playerName: 'Bob', normalizedPlayerName: 'bob', lapMs: 100_000 }),
    ]);

    const response = await handleLeaderboardRequest(
      new Request('https://example.test/api/leaderboard?track=monza-gp&limit=10'),
      store,
    );
    const body = await response.json() as { entries: LeaderboardEntry[] };

    expect(response.status).toBe(200);
    expect(body.entries.map(({ playerName, lapMs, rank }) => ({ playerName, lapMs, rank }))).toEqual([
      { playerName: 'ALICE', lapMs: 99_000, rank: 1 },
      { playerName: 'Bob', lapMs: 100_000, rank: 2 },
    ]);
  });

  it('stores an accepted lap as a server-authored client-integrity entry', async () => {
    const store = memoryStore();
    const response = await handleLeaderboardRequest(
      new Request('https://example.test/api/leaderboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerName: '  Max Power ',
          trackId: 'monza-gp',
          lapMs: 98_432,
          build: 'v0.1',
          ruleset: 'monza-gp-v1',
          integrity: { valid: true, invalidReason: null },
        }),
      }),
      store,
    );

    expect(response.status).toBe(201);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({
      playerName: 'Max Power',
      normalizedPlayerName: 'max power',
      lapMs: 98_432,
      verification: 'client-integrity',
    });
    expect(store.saved[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects invalid submissions without writing', async () => {
    const store = memoryStore();
    const response = await handleLeaderboardRequest(
      new Request('https://example.test/api/leaderboard', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          playerName: 'Cheater',
          trackId: 'monza-gp',
          lapMs: 12_000,
          build: 'v0.1',
          ruleset: 'monza-gp-v1',
          integrity: { valid: false, invalidReason: 'reset' },
        }),
      }),
      store,
    );

    expect(response.status).toBe(400);
    expect(store.saved).toHaveLength(0);
  });
});
