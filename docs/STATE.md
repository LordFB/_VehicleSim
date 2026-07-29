# Session state

## Last updated

2026-07-29 by Codex

## Current phase

development

## Current milestone

Milestone 011 - Deterministic Race Damage (`docs/milestones/011-deterministic-race-damage.md`)

## Last action

Fixed the Turn 1 launch regression in standalone Monza. The Rettifilo escape-road mesh had carried a 14 cm visual lift into the physics surface, producing an 11.2 cm collision step across the approach. Its collision geometry now matches the terrain road crown, grade, bank, and normal at the join. A focused seam regression test, the related Monza/runtime tests, a live Chromium geometry/state/console probe, visual capture, and the production build pass.

## Next step

User drives through Variante del Rettifilo to confirm the launch is gone, then completes a clean Monza lap—especially Roggia and both Lesmos—to confirm no invisible boundary is encountered before the visible Armco.

## Blockers

- Milestone 008 still requires a future linked Netlify deployment for its hosted-store exit condition.
- The pre-existing `flipRepro` diagnostic may exceed its five-second timeout after producing output.
- The full unit suite currently also has unrelated expectation failures in `cockpitWheelView.test.ts` and `vehicleViewSmoothing.test.ts`; the focused environment tests are green.
- Milestone 011's HUD/feel acceptance criterion remains pending user playtest.

## Notes for next session

Damage is race-session-local and does not affect Time Trial or its leaderboard. ADR 0006 records worker authority and the model-neutral consequence boundary.
Milestone 004 has a follow-up reference-fidelity AC pending the user's visual playtest; source imagery is used only as research and is not bundled into the game.
