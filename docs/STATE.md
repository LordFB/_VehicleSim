# Session state

## Last updated

2026-07-26 by Codex

## Current phase

development

## Current milestone

Milestone 006 - Vehicle Sim v0.1 on Standalone Monza (`docs/milestones/006-vehicle-sim-v0.1.md`)

## Last action

Completed a v0.1 playtest-fidelity pass on standalone Monza. Fixed the barrier-side contract that put both physical guardrail rows on one side of the circuit; straight sections now use longer continuous collision chords while tight corners retain shorter, better-fitting chords.

Added the shared persistent `SetupModal` to Monza with live physics, input, assists, final-drive, and transmission application. `P` opens setup and the quick auto/manual button now persists into the same setup state.

The chase camera now uses a fixed 7.2 m offset with restrained speed FOV. Cockpit mode is rigid to the chassis at 63° and renders the dedicated live steering wheel, shift LEDs, coaming, and slimmed halo instead of the external car. Removed random onboard shake.

Reduced full-resolution cost with a 1.5 DPR cap, 1024² shadow map, fewer collision boxes, fewer wheel meshes/segments, and no tiny aero shadow casters. Removed overlapping livery and concentric wheel surfaces that caused depth flicker. The F3 now has brighter painted sidepods/engine cover and realistic black slicks instead of tire-temperature blue.

Verification passed: focused Vitest (11 tests), TypeScript and production build, all standalone Playwright checks including integrated draw-call budget, setup dialog, fixed chase distance, and driving. Visual captures: `output/iterate/2026-07-26-v0.1-fidelity-chase-final.png` and `output/iterate/2026-07-26-v0.1-fidelity-onboard-final.png`.

## Next step

User playtest the corrected two-sided guardrail collisions and revised vehicle/camera feel. Open `/monza.html`, press `P` for setup, and tune or reset the car while driving.

## Blockers

`scripts/monza-verify.mjs` is still brittle when port 3000 is occupied: it lets Vite fall back to 3001 but waits on 3000. Use a fixed `--strictPort` Vite process for standalone Playwright checks.

Existing unrelated full-suite issues from prior sessions may still remain: vehicle physics/diagnostic coverage failures in `tests/scenarios/thermalFade.test.ts`, `tests/scenarios/vehicleScenarios.test.ts`, `tests/unit/accelDiag.test.ts`, and `tests/unit/flipRepro.test.ts`.

## Notes for next session

The integrated v0.1 experience is `/monza.html`; the original modular simulator remains at `/`, Nordschleife at `/?track=nordschleife`, and TrackPrint at `/track-editor`. Standalone controls: `W/S`, `A/D`, `E/Q`, `G`, `Space`, `C`, `R`, `L`, and `M`. The simulator starts in neutral/manual, so press `E` before throttle or switch automatic on.
