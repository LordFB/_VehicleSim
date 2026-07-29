# ADR 0006: Deterministic Component Damage

## Status

accepted

## Date

2026-07-28

## Context

Race contact currently resolves momentum but has no lasting consequence. A damage system must behave consistently across the full player vehicle and lightweight AI model without making Three.js geometry authoritative.

## Decision

The race worker owns a normalized component-health model. Barrier and car contact feed local impact direction and closing-speed severity into a pure deterministic damage function. The resulting state is converted into model-neutral effects—power, shifting, downforce, drag, per-wheel grip, steering scale/bias, and retirement—which each vehicle runtime consumes. Rendering and HUD only display snapshot damage.

Damage persists across reset-to-track and is recreated only with a new race session. No random failure rolls are used.

## Consequences

- Replays and AI-only races remain deterministic.
- Full and lightweight physics share damage rules while applying consequences through their own dynamics.
- Contact-region approximation uses the chassis frame rather than rendered bodywork.
- Visual detachment and repair systems can be added later without changing damage authority.

## Related

- `docs/milestones/011-deterministic-race-damage.md`
- `docs/architectural-decisions/0005-monza-app-flow-and-multi-car-races.md`
