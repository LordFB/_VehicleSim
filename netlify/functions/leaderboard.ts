import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { COMPETITION } from '../../src/core/Constants';
import {
  handleLeaderboardRequest,
} from '../lib/leaderboard';
import { createBlobLeaderboardStore } from '../lib/blobLeaderboardStore';

export default async (request: Request, _context: Context): Promise<Response> => {
  const blobs = getStore({
    name: COMPETITION.STORE_NAME,
    consistency: 'strong',
  });
  return handleLeaderboardRequest(request, createBlobLeaderboardStore(blobs));
};

export const config: Config = {
  path: '/api/leaderboard',
  method: ['GET', 'POST'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowSize: COMPETITION.RATE_WINDOW_SECONDS,
    windowLimit: COMPETITION.RATE_WINDOW_LIMIT,
  },
};
