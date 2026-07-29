# Milestone 011: Deterministic Race Damage

## Status

in progress

## Objective

Make race contact consequential through deterministic component damage that changes vehicle performance, can puncture tires or retire a car, persists through reset-to-track, and is visible to the driver.

## Scope

- Track front/rear aero, four suspension corners, four tires, engine, gearbox, and chassis health per race vehicle.
- Derive damage from barrier and car-contact closing speed plus the local impact region.
- Apply power, aero, drag, grip, steering-pull, and puncture consequences to both full player physics and lightweight AI tire physics.
- Retire critically damaged cars and classify them behind finishers.
- Expose component health and the latest impact through race snapshots, deterministic text state, and the race HUD.
- Clear damage only when starting/restarting the race; reset-to-track retains it.

## Out of scope

- Detached visual bodywork, repairable pit stops, fire, debris collision, and mechanical wear without an impact.

## Acceptance criteria

- [x] Identical impacts produce identical localized component damage, and sub-threshold contact produces none. — test: `tests/unit/raceDamage.test.ts`
- [x] Damage effects deterministically reduce aero/power/grip, introduce suspension steering pull, and represent punctures. — test: `tests/unit/raceDamage.test.ts`
- [x] Barrier and vehicle impacts accumulate damage; reset retains damage; critical damage retires and classifies a car. — test: `tests/unit/fullRaceDamage.test.ts`
- [ ] Race snapshots and `render_game_to_text()` expose damage state, while the focused-car HUD identifies the worst component and retirement state. — tests: `tests/unit/fullRaceDamage.test.ts`, verified by user playtest

## Exit condition

User damages the car in a race, observes a matching handling/performance change and HUD warning, resets without magically repairing it, then restarts/rematches to receive a fresh car.
