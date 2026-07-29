# Milestone 010: Race a Twelve-Car Monza Grid

## Status

in progress

## Objective

Add a deterministic 12-car, three-lap Monza race that can be driven from sixth on the grid or watched as an all-AI event, with collision-aware opponents, race control, and a local classification.

## Scope

- Add a separate batched race physics facade and deterministic race runtime.
- Run full Time Trial physics for the player and a lightweight tire/slip model for AI, with collision-active chassis bodies.
- Add standing start, three-lap ordering, reset penalties, finish classification, race HUD, results, and spectator focus controls.
- Expose deterministic race state through `render_game_to_text()` and `advanceTime()`.

## Out of scope

- Damage, qualifying, flags, pit stops, failures, multiplayer, or online race results.
- Wheel-to-wheel collision geometry; race contact uses chassis volumes.

## Dependencies

- **Depends on:** Milestone 009, ADR 0005
- **Blocks:** none

## Acceptance criteria

- [ ] Race contracts expose stable vehicle IDs, batched controls, course data, and deterministic 12-car snapshots without changing the single-car facade. — test: `tests/unit/raceRuntime.test.ts`
- [ ] AI inputs, proximity fidelity hysteresis, collision separation/impulses, and replay results are deterministic. — test: `tests/unit/raceRuntime.test.ts`
- [ ] Standing start, three-lap ordering, participant finish, watch-mode finish, five-second reset penalties, and two-second ghosting classify correctly. — test: `tests/unit/raceSession.test.ts`
- [ ] Participate starts the player sixth with 11 AI; Watch Race starts 12 AI and focus/camera changes do not affect simulation results. — tests: `tests/unit/raceSession.test.ts`, `tests/e2e/monza-menu.spec.ts`
- [ ] A representative 12-car headless run advances faster than real time without exhausting catch-up. — test: `tests/unit/racePerformance.test.ts`
- [ ] Race HUD/results are readable, results stay local, and Time Trial leaderboard behavior is unchanged. — test: `tests/e2e/monza-menu.spec.ts`

## Exit condition

User starts Participate or Watch Race from `/`, observes a 12-car standing start and three-lap classification, then rematches or returns to the main menu without stale state.

## Test plan

Write deterministic runtime/rules tests before implementation, then add browser flows for participant and spectator sessions. Run focused and full Vitest, menu and legacy Playwright suites, production build, deterministic text-state stepping, and a manual three-lap playtest.

## Notes

The player retains the full Time Trial physics implementation. AI always uses the deterministic lightweight tire model; camera selection and proximity do not alter its fidelity. Every car retains an active collision body.
