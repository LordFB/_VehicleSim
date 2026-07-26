# Milestone 007: Competition Lap Integrity

## Status

done

## Objective

Make standalone Monza lap timing safe to build an online competition on by giving race control explicit lap-validity state. This is first because names and leaderboard persistence would otherwise publish reset-assisted and off-track laps.

## Scope

- Invalidate the active lap when all four contacting wheels are on illegal surfaces.
- Keep the lap valid while at least one wheel remains on asphalt or kerb.
- Invalidate the active lap on any car reset or teleport.
- Discard invalid laps at the line, visibly mark the current lap invalid, and begin the following lap cleanly.
- Expose race-control state through `render_game_to_text()`.

## Out of scope

- Player-name/profile UI.
- Online leaderboard persistence and queries.
- Server-side replay/evidence validation.

## Dependencies

- **Depends on:** Milestone 006 standalone Vehicle Sim physics integration
- **Blocks:** player identity/leaderboard UI and Netlify leaderboard service

## Acceptance criteria

- [x] Four wheels simultaneously contacting grass or gravel invalidate the active lap; one wheel on asphalt or kerb keeps it valid. — test: `tests/unit/competitionLap.test.ts`
- [x] Reset invalidates the active lap and a reset-assisted line wrap cannot update last or best time. — test: `tests/unit/competitionLap.test.ts`
- [x] Crossing the line discards an invalid lap, starts a clean next lap, and only a later valid lap can become last/best. — test: `tests/unit/competitionLap.test.ts`
- [x] Standalone Monza displays an INVALID status/reason and exposes lap validity in `render_game_to_text()`. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`

## Exit condition

User drives all four wheels off track or presses reset, then crosses start/finish → the lap is visibly invalid and never becomes a personal best; the next clean lap can be recorded normally.

## Test plan

Write the pure race-control unit tests first and confirm they fail because the module is absent. Add standalone HTML contract and browser assertions, then run focused Vitest, the standalone Playwright suite, and the production build. Finish with a console-clean `render_game_to_text()` live snapshot.

## Notes

Legal racing surfaces for this milestone are `asphalt_new`, `painted_line`, and `kerb`. Airborne wheels do not count as being off track; invalidation requires all four wheels to have surface contact on illegal materials in the same physics snapshot.

Automated verification completed 2026-07-26: focused Vitest (12 tests), production build, and the standalone Vehicle Sim browser test. Visual capture: `output/iterate/2026-07-26-competition-reset-invalid.png`. User confirmed the exit-condition playtest on 2026-07-27.
