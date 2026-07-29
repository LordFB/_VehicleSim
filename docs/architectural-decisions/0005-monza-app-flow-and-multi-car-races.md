# ADR 0005: Monza App Flow and Deterministic Multi-Car Races

## Status

accepted

## Date

2026-07-27

## Context

Monza currently boots a single worker-driven Time Trial directly from a large standalone HTML entry. A root menu and twelve-car race require restart-safe scene ownership, batched simulation state, deterministic AI, and car contact without weakening the existing player physics or tying authority to Three.js.

## Decision

Serve the Monza application shell at the clean root, govern its scenes with a typed transition-table state machine, and implement races through a separate worker-owned `RacePhysicsFacade`. The player always uses the full Time Trial vehicle dynamics. AI uses a deterministic planar tire model with axle loads, slip angles, friction circles, aero, braking, yaw response, and active chassis contact. Race control and batched snapshots remain authoritative in the worker. Rendering and spectator focus consume snapshots and never influence simulation.

## Consequences

### Positive

- Menu and gameplay sessions can be repeatedly entered and disposed without leaked state.
- Existing single-car physics callers remain compatible.
- Twelve-car races can fit a desktop-browser budget without camera-dependent simulation.
- Race behavior is testable through deterministic snapshots and replays.

### Negative

- Two vehicle-dynamics implementations require shared snapshot contracts and performance tests.
- Chassis-only contact is less detailed than wheel-to-wheel open-wheel collision.
- The legacy generic simulator moves to a named route.

## Alternatives considered

- **Full vehicle model for all twelve cars:** rejected for the initial browser performance budget.
- **Ghost opponents:** rejected because the requested race requires real contact.
- **Proximity switching between full and simplified AI physics:** rejected after live profiling; full suspension and drivetrain simulation on nearby AI caused the worker to fall behind at the grid start.
- **Camera-distance LOD:** rejected because presentation must not change authoritative physics.
- **Replace the existing physics facade:** rejected to avoid breaking Time Trial and editor flows.

## Related

- `docs/milestones/009-monza-app-shell.md`
- `docs/milestones/010-monza-circuit-race.md`
