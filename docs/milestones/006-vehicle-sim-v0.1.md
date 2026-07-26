# Milestone 006: Vehicle Sim v0.1 on Standalone Monza

## Status

in-progress

## Objective

Make the full-scale standalone Monza showcase the canonical Vehicle Sim v0.1 driving experience by replacing its arcade `RaceCar` runtime with the project's worker-based vehicle dynamics and F3 vehicle view.

## Scope

- Build a physics `WorldSpec` directly from the standalone circuit's exact centerline, elevation, camber, width, and barrier geometry.
- Run the validated Vehicle Sim worker physics, drivetrain, tires, suspension, setup, input, and vehicle rendering inside `/monza.html`.
- Carry over the telemetry-driven engine/wind/tire audio, pooled skid marks, and pooled tire smoke from the main simulator.
- Adapt physics snapshots to the standalone Monza HUD, camera rig, lap map, and deterministic browser probes.
- Brand the integrated page as Vehicle Sim v0.1 and make it the primary experience.
- Preserve the standalone track geometry and reference-detail quality contracts from Milestone 005.

## Acceptance criteria

- [x] `/monza.html` boots the `MonzaVehicleSim` bridge and does not instantiate the arcade `RaceCar`. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] The physics world is generated from the full 5,793 m standalone centerline with matching elevation, camber, spawn heading, track width, and collidable edge barriers. — test: `tests/unit/monzaVehicleSim.test.ts`
- [x] Physics snapshots drive the F3 vehicle view and existing Monza HUD/camera state. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] Physics snapshots drive engine audio, skid marks, and tire smoke; `M` toggles mute and reset clears accumulated skid marks. — tests: `tests/unit/monzaVehicleSim.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] The integrated experience identifies itself as `Vehicle Sim v0.1` and exposes that version through `render_game_to_text()`. — tests: `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] Existing standalone Monza geometry/detail tests and the production build remain green. — verified with focused Vitest, all three standalone Playwright checks, and `npm run build`
- [ ] Driving from the start line through Rettifilo with manual or automatic transmission feels like the main Vehicle Sim, not the former arcade demo. — verified by user playtest

## Exit condition

User opens `/monza.html`, launches the F3 car with the Vehicle Sim controls, and drives the detailed full-scale Monza circuit with the validated simulator physics under the v0.1 identity.

## Playtest refinement acceptance

- [ ] Physical barriers occupy both visible track edges, remain continuous, and no longer produce one-sided or phantom impacts. — tests: `tests/unit/monzaVehicleSim.test.ts`, user playtest
- [ ] The chase camera is removed from the main and standalone camera cycles; onboard is the default driving view, with nose/broadcast alternatives retained. — tests: `tests/unit/raceCamera.test.ts`, `tests/unit/cameraController.test.ts`, `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [ ] Onboard view uses a rigid driver-eye pose, restrained 63° FOV, and a dramatically richer halo-free cockpit with nose bodywork, front suspension/wheels, mirrors, dash controls, and a live steering display. — tests: `tests/unit/cockpitWheelView.test.ts`, visual inspection
- [x] The shared car setup panel is available from Monza, applies physics, input, and transmission changes live, persists them, and resets to stock. — tests: `tests/unit/monzaVehicleSim.test.ts`, `tests/unit/monzaStandaloneHtml.test.ts`, `tests/e2e/monza-standalone.spec.ts`
- [x] The vehicle and standalone render pass remove avoidable overlapping surfaces and stay within the integrated draw-call/performance budget. — tests: `tests/e2e/monza-standalone.spec.ts`, visual inspection
