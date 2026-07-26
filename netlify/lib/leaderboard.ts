import { COMPETITION } from '../../src/core/Constants';
import {
  MONZA_TRACK_ID,
  normalizePlayerKey,
  parseLapSubmission,
  type LeaderboardEntry,
} from '../../src/competition/LeaderboardContract';

export type LeaderboardStore = {
  save(entry: LeaderboardEntry): Promise<void>;
  list(trackId: string): Promise<LeaderboardEntry[]>;
};

export async function handleLeaderboardRequest(
  request: Request,
  store: LeaderboardStore,
): Promise<Response> {
  if (request.method === 'GET') return getLeaderboard(request, store);
  if (request.method === 'POST') return submitLap(request, store);
  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
}

async function getLeaderboard(request: Request, store: LeaderboardStore): Promise<Response> {
  const url = new URL(request.url);
  const trackId = url.searchParams.get('track') ?? MONZA_TRACK_ID;
  if (trackId !== MONZA_TRACK_ID) return json({ error: 'Unsupported track' }, 400);

  const requestedLimit = Number(url.searchParams.get('limit') ?? COMPETITION.DEFAULT_LIMIT);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(COMPETITION.MAX_LIMIT, Math.max(1, Math.floor(requestedLimit)))
    : COMPETITION.DEFAULT_LIMIT;
  const allEntries = await store.list(trackId);
  const bestByDriver = new Map<string, LeaderboardEntry>();
  for (const entry of allEntries) {
    const previous = bestByDriver.get(entry.normalizedPlayerName);
    if (!previous || entry.lapMs < previous.lapMs) bestByDriver.set(entry.normalizedPlayerName, entry);
  }
  const entries = [...bestByDriver.values()]
    .sort((a, b) => a.lapMs - b.lapMs || a.submittedAt.localeCompare(b.submittedAt))
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  return json({ trackId, entries }, 200);
}

async function submitLap(request: Request, store: LeaderboardStore): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Malformed JSON' }, 400);
  }
  const submission = parseLapSubmission(body);
  if (!submission) return json({ error: 'Lap submission rejected' }, 400);

  const entry: LeaderboardEntry = {
    id: crypto.randomUUID(),
    playerName: submission.playerName,
    normalizedPlayerName: normalizePlayerKey(submission.playerName),
    trackId: submission.trackId,
    lapMs: submission.lapMs,
    build: submission.build,
    ruleset: submission.ruleset,
    submittedAt: new Date().toISOString(),
    verification: 'client-integrity',
  };
  await store.save(entry);
  return json({ entry }, 201);
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
