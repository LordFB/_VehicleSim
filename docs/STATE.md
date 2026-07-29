# Session state

## Last updated

2026-07-29 by Codex

## Current phase

development

## Current milestone

Milestone 011 - Deterministic Race Damage (`docs/milestones/011-deterministic-race-damage.md`)

## Last action

Increased the stock F3 aerodynamic lift area from 2.6 to 3.8 m²-equivalent so tire load rises from 1.71× to just over 2× static weight near 200 km/h. Added `tests/unit/aeroGrip.test.ts` to protect the high-speed load response; focused aero, tire, rollover, no-aids, routing, and race-performance tests pass. Also fixed clean Netlify TypeScript builds by declaring `@types/node`, locking it, and enabling the `node` type environment in `tsconfig.json`; `npm run build` passes.

## Next step

Retry the Netlify deploy, then drive a Time Trial lap to confirm the car becomes noticeably more planted through high-speed corners while retaining its low-speed mechanical-grip behavior.

## Blockers

- Milestone 008 still requires a future linked Netlify deployment for its hosted-store exit condition.
- The pre-existing `flipRepro`, `accelDiag`, and `rolloverDiag` diagnostics may exceed their five-second timeouts under full-suite load after producing valid output.
- The full unit suite currently also has unrelated expectation failures in `cockpitWheelView.test.ts` and `vehicleViewSmoothing.test.ts`; the focused environment tests are green.
- Milestone 011's HUD/feel acceptance criterion remains pending user playtest.

## Notes for next session

Damage is race-session-local and does not affect Time Trial or its leaderboard. ADR 0006 records worker authority and the model-neutral consequence boundary.
Milestone 004 has a follow-up reference-fidelity AC pending the user's visual playtest; source imagery is used only as research and is not bundled into the game.
Milestone 006's final driving-feel acceptance remains user-playtest verified; the new aero regression is automated.
