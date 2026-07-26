# Milestone 003: Racing Camera and F3 Onboard View

## Objective

Add a shippable racing camera system with chase, onboard, and nose views, plus a procedural Formula 3 onboard steering wheel driven by live physics telemetry.

## Scope

- Replace the single chase-camera path with a mode-aware camera controller.
- Add keyboard and gamepad camera cycling without changing transmission controls.
- Add an onboard F3 cockpit/wheel view using procedural Three.js geometry.
- Keep all camera and cockpit tuning constants in the renderer configuration.
- Verify the camera modes, input events, onboard wheel visibility, and browser smoke path.

## Acceptance Criteria

- [x] Chase, onboard, and nose camera poses are unit-tested for placement, horizon stability, FOV behavior, and mode-specific smoothing. Covered by `tests/unit/raceCamera.test.ts`.
- [x] `C` on keyboard and D-pad up on gamepad cycle camera modes while `G` and gamepad View still control transmission mode. Covered by `tests/unit/inputCameraControls.test.ts`.
- [x] Onboard mode shows a procedural F3-style steering wheel whose rotation follows `steeringAngleRad`; exterior views hide it. Covered by `tests/unit/cockpitWheelView.test.ts`.
- [x] Browser smoke can force/cycle onboard mode, render a nonblank canvas, reset repeatedly, and resize without camera errors. Covered by `tests/e2e/app.spec.ts` camera smoke test.
- [x] Build and focused camera/input/render tests pass. Verified with `npm test -- tests/unit/raceCamera.test.ts tests/unit/inputCameraControls.test.ts tests/unit/cockpitWheelView.test.ts`, `npm run build`, and targeted `npx playwright test --project chromium --grep "camera modes"`.

## Exit Condition

User can drive the sim, press `C` to cycle Chase -> Onboard -> Nose, see a stable F3 cockpit view with a live virtual steering wheel, and return to chase view without console errors.
