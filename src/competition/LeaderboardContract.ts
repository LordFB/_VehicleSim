import { COMPETITION } from '../core/Constants';

export const LEADERBOARD_API_PATH = COMPETITION.API_PATH;
export const MONZA_TRACK_ID = COMPETITION.TRACK_ID;
export const COMPETITION_RULESET = COMPETITION.RULESET;
export const COMPETITION_BUILD = COMPETITION.BUILD;

export type LapSubmission = {
  playerName: string;
  trackId: string;
  lapMs: number;
  build: string;
  ruleset: string;
  integrity: {
    valid: boolean;
    invalidReason: string | null;
  };
};

export type LeaderboardEntry = {
  id: string;
  playerName: string;
  normalizedPlayerName: string;
  trackId: string;
  lapMs: number;
  build: string;
  ruleset: string;
  submittedAt: string;
  verification: 'client-integrity';
  rank?: number;
};

export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const length = Array.from(normalized).length;
  if (
    length < COMPETITION.PLAYER_NAME_MIN_LENGTH ||
    length > COMPETITION.PLAYER_NAME_MAX_LENGTH
  ) {
    return null;
  }
  return /^[\p{L}\p{N} ._-]+$/u.test(normalized) ? normalized : null;
}

export function normalizePlayerKey(playerName: string): string {
  return playerName.normalize('NFKC').toLocaleLowerCase('en-US');
}

export function parseLapSubmission(value: unknown): LapSubmission | null {
  if (!isRecord(value)) return null;
  const playerName = normalizePlayerName(value.playerName);
  const integrity = value.integrity;
  if (
    playerName === null ||
    value.trackId !== MONZA_TRACK_ID ||
    value.build !== COMPETITION_BUILD ||
    value.ruleset !== COMPETITION_RULESET ||
    !Number.isInteger(value.lapMs) ||
    (value.lapMs as number) < COMPETITION.MIN_LAP_MS ||
    (value.lapMs as number) > COMPETITION.MAX_LAP_MS ||
    !isRecord(integrity) ||
    integrity.valid !== true ||
    integrity.invalidReason !== null
  ) {
    return null;
  }
  return {
    playerName,
    trackId: MONZA_TRACK_ID,
    lapMs: value.lapMs as number,
    build: COMPETITION_BUILD,
    ruleset: COMPETITION_RULESET,
    integrity: { valid: true, invalidReason: null },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
