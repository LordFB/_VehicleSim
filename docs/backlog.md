# Backlog

> Out-of-scope ideas, feature requests, and follow-ups captured during sessions but not worked on in the session that captured them. Append-only: promoted items are checked and linked, not deleted.

## Gameplay & features

- [x] Player identity and leaderboard UI — add a polished competition panel for setting a persistent player name and browsing track standings. → milestone 008-netlify-leaderboards.md
  - Source: 2026-07-26 user request for player name and leaderboard UI
  - Rough size: M · Rough value: L
  - Notes: Depends on the competition integrity contract in Milestone 007; should degrade clearly when the online service is unavailable.

- [x] Netlify leaderboard service — persist and query per-track standings through a server-side Netlify boundary. → milestone 008-netlify-leaderboards.md
  - Source: 2026-07-26 user clarification that Netlify is the deployment target
  - Rough size: L · Rough value: L
  - Notes: Requires an explicit storage choice and abuse controls. Client-submitted elapsed time alone is not authoritative.

- [ ] Authoritative lap evidence validation — submit sufficient deterministic run evidence for server-side rule, continuity, setup, and plausibility checks.
  - Source: 2026-07-26 request for a solid online competition with strict rule checking
  - Rough size: L · Rough value: L
  - Notes: Architecture-enabling security work; design before public leaderboard launch.

## Polish & juice

## Tech & refactors

## Tooling & QA

## Open questions

- [x] Competition identity policy — decide whether names are anonymous local handles, authenticated accounts, or provider-backed profiles. → milestone 008-netlify-leaderboards.md
  - Source: 2026-07-26 player-name request
  - Rough size: S · Rough value: M
  - Notes: Milestone 008 uses persistent anonymous local handles; authenticated ownership remains out of scope.
