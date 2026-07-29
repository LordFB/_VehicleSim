# Milestone 008: Netlify Leaderboards

## Status

deferred

## Objective

Ship the first usable online competition surface: a player can choose a persistent local driver name, browse Monza standings, and automatically submit only race-control-approved completed laps through a validated Netlify Function.

## Scope

- Add an accessible competition drawer with player-name, loading, empty, offline, submission, and ranked-table states.
- Persist an anonymous local player handle and normalize/validate it consistently on client and server.
- Add a same-origin GET/POST Netlify Function at `/api/leaderboard`.
- Persist accepted laps as immutable Netlify Blob entries and derive one best result per driver.
- Reject invalid shapes, unsupported tracks/builds, implausible times, invalid race-control state, and reset/off-track laps.
- Expose leaderboard UI/service state through `render_game_to_text()`.

## Out of scope

- Authenticated accounts, unique name ownership, moderation tooling, seasons, car classes, and setup-specific boards.
- Replay/input verification capable of defeating a deliberately forged HTTP client.
- Production deployment or linking this repository to a Netlify project.

## Dependencies

- **Depends on:** Milestone 007 competition integrity, ADR 0004
- **Blocks:** authoritative lap evidence validation

## Acceptance criteria

- [x] Player names normalize safely, persist locally, and invalid names cannot be submitted. — test: `tests/unit/leaderboardContract.test.ts`, `tests/unit/competitionPanel.test.ts`
- [x] GET returns ranked best-per-driver results and POST rejects malformed, invalid, reset/off-track, unsupported-build, or implausible submissions. — test: `tests/unit/leaderboardFunction.test.ts`
- [x] Accepted laps are stored under immutable unique keys and returned with `client-integrity` verification. — test: `tests/unit/leaderboardFunction.test.ts`
- [x] Standalone Monza mounts the competition drawer, submits only valid completed laps, handles offline service states, and exposes leaderboard state to browser probes. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] Netlify configuration builds `dist` and discovers `netlify/functions`; the Function config routes `/api/leaderboard` and rate-limits requests. — test: `tests/unit/netlifyConfig.test.ts`

## Exit condition

User opens Competition, saves a driver name, completes a valid Monza lap, and refreshes standings → the submitted time appears at the correct rank and survives a page reload; invalid laps never submit.

## Test plan

Write red-first unit tests for the shared contract, storage-independent Function handler, UI/local persistence, HTML integration, and `netlify.toml`. Add a Playwright route mock for deterministic browser loading/submission without production credentials. Run focused Vitest, the standalone browser test, Netlify function build/type checking, and the production Vite build. Finish with a console-clean screenshot and `render_game_to_text()` snapshot.

## Notes

This milestone deliberately labels entries `client-integrity`. It is suitable for a first public casual board, not prizes or stewarded esports. ADR 0004 records the immutable-write storage model and its limits.

The hosted Netlify smoke test was explicitly deferred on 2026-07-27 so Milestones 009 and 010 could proceed. The implementation and automated checks remain intact; this milestone is not complete until its production exit condition is exercised.

## Verification

- Focused competition and integration unit tests: 18 passed.
- Production Vite build: passed.
- Netlify function bundle: passed with Netlify CLI 25.6.2.
- Integrated Playwright browser test: passed, including valid submission and invalid reset-lap rejection.
- Full unit suite: 86 of 87 passed; the pre-existing `flipRepro` diagnostic exceeded its five-second timeout after producing its diagnostic output.
- Production Netlify deployment/link and a real hosted Blobs smoke test remain the milestone exit condition.
