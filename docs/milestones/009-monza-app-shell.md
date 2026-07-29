# Milestone 009: Open Monza From a Main Menu

## Status

in-progress

## Objective

Make Monza the clean-root application and add an explicit, restart-safe menu lifecycle without breaking the generic simulator, TrackPrint editor, or existing Time Trial competition.

## Scope

- Serve `monza.html` at `/` in Vite dev/preview and Netlify while preserving `/monza.html`.
- Replace `index.html` with a named `simulator.html` legacy entry and preserve `/track-editor`.
- Add the Monza menu, Race submenu, pause flow, and typed transition-table state machine.
- Delay gameplay initialization until a mode is selected and dispose active sessions on return to menu.

## Out of scope

- Multi-car simulation and race classification; Milestone 010 consumes this shell.
- Redesigning the existing Time Trial HUD, setup, or leaderboard.

## Dependencies

- **Depends on:** ADR 0005
- **Blocks:** Milestone 010

## State graph

| From | Event | To |
| --- | --- | --- |
| menu | openRace | raceMenu |
| raceMenu | back | menu |
| menu | startTimeTrial | loading |
| raceMenu | startParticipate / startWatch | loading |
| loading | loadedTimeTrial | timeTrial |
| loading | loadedRace | raceCountdown |
| timeTrial / raceCountdown / raceRunning | pause | paused |
| paused | resume | previous playable state |
| paused / raceResults | mainMenu | menu |
| raceCountdown | greenFlag | raceRunning |
| raceRunning | finish | raceResults |

## Acceptance criteria

- [ ] `/` serves Monza, `/monza.html` remains valid, `index.html` is absent, and the production build contains the expected named entries. — test: `tests/unit/appRouting.test.ts`
- [ ] `/track-editor` and TrackPrint race export resolve through `simulator.html`. — tests: `tests/unit/appRouting.test.ts`, `tests/e2e/app.spec.ts`
- [ ] The transition table accepts every documented transition, rejects invalid transitions with a warning, and resumes the previous playable state. — test: `tests/unit/monzaAppFlow.test.ts`
- [ ] The menu boots before gameplay; Time Trial preserves competition behavior; returning to menu and reopening three times does not duplicate a session. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-menu.spec.ts`

## Exit condition

User opens `/`, chooses Time Trial, returns to the menu, opens the Race submenu, and can repeat the flow three times without stale sessions or console errors.

## Test plan

Write routing, transition, raw HTML, and Playwright checks first and confirm they fail on the existing direct-boot page. Run focused Vitest, the menu E2E, the existing generic/editor E2E, and `npm run build`. Finish with a console-clean menu screenshot and `render_game_to_text()` state.

## Notes

The hosted Milestone 008 smoke test remains deferred, not completed. No new UI or FSM dependency is introduced.
