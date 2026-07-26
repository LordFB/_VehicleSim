import type { LeaderboardEntry } from '../../src/competition/LeaderboardContract';
import type { LeaderboardStore } from './leaderboard';

export type BlobStoreLike = {
  setJSON(
    key: string,
    value: unknown,
    options?: { onlyIfNew?: boolean },
  ): Promise<unknown>;
  list(options?: { prefix?: string }): Promise<{ blobs: Array<{ key: string }> }>;
  get(key: string, options: { type: 'json' }): Promise<unknown>;
};

export function createBlobLeaderboardStore(blobs: BlobStoreLike): LeaderboardStore {
  return {
    async save(entry) {
      const key = [
        entry.trackId,
        String(entry.lapMs).padStart(9, '0'),
        entry.id,
      ].join('/');
      await blobs.setJSON(key, entry, { onlyIfNew: true });
    },
    async list(trackId) {
      const { blobs: items } = await blobs.list({ prefix: `${trackId}/` });
      const entries = await Promise.all(items.map(async ({ key }) =>
        blobs.get(key, { type: 'json' }) as Promise<LeaderboardEntry | null>,
      ));
      return entries.filter((entry): entry is LeaderboardEntry => entry !== null);
    },
  };
}
