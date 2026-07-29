# Vehicle Sim Gameplan

## Pitch

Vehicle Sim is a browser-based hardcore vehicle dynamics sandbox: one high-fidelity car, telemetry, setup tuning, and real circuit layouts rendered in Three.js while custom TypeScript physics owns the simulation state.

## Core Loop

1. Open the Monza main menu and choose Time Trial or Race.
2. In Time Trial, drive, read telemetry, tune the setup, and repeat valid competition laps.
3. In Race, join an eleven-car AI field or watch a twelve-car AI race.
4. Complete a three-lap standing-start race and review the local classification.
5. Compare valid Time Trial laps on the online leaderboard.

## Current Content

- Monza is the default verified circuit.
- Nordschleife is being added as a clean procedural reconstruction using open map geometry plus authored terrain and detail.
- Monza provides a 12-car, three-lap circuit race in participant and AI-spectator variants.

## Design Priorities

- Vehicle physics, tire behavior, and surface feedback matter more than visual excess.
- Rendering is a view of physics state, not the source of truth.
- Tracks should be generated from committed, auditable data so tests and screenshots are deterministic.
- Competition laps are invalid when all four wheels leave the legal racing surface or the car is reset/teleported.
- Online standings must reject implausible or incomplete lap evidence rather than trusting a browser-supplied time.
- Race results are local to the current session; the online leaderboard remains exclusive to Time Trial.
- Race contact causes persistent component damage: aero loss, alignment/grip degradation, punctures, powertrain loss, and possible retirement. Reset-to-track is not a repair.

## Anti-Goals

- Do not import ripped or copyrighted track assets from other games.
- Do not make Three.js render meshes the physics collision source.
- Do not replace the vehicle model with arcade raycast driving shortcuts.
