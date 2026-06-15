# Vehicle Sim Gameplan

## Pitch

Vehicle Sim is a browser-based hardcore vehicle dynamics sandbox: one high-fidelity car, telemetry, setup tuning, and real circuit layouts rendered in Three.js while custom TypeScript physics owns the simulation state.

## Core Loop

1. Pick a circuit from the URL or default.
2. Drive the car with keyboard or controller.
3. Read HUD, lap timing, and telemetry.
4. Tune setup values and repeat laps to understand handling changes.

## Current Content

- Monza is the default verified circuit.
- Nordschleife is being added as a clean procedural reconstruction using open map geometry plus authored terrain and detail.

## Design Priorities

- Vehicle physics, tire behavior, and surface feedback matter more than visual excess.
- Rendering is a view of physics state, not the source of truth.
- Tracks should be generated from committed, auditable data so tests and screenshots are deterministic.

## Anti-Goals

- Do not import ripped or copyrighted track assets from other games.
- Do not make Three.js render meshes the physics collision source.
- Do not replace the vehicle model with arcade raycast driving shortcuts.
