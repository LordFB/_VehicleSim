# ADR 0003: TrackPrint Editor Integration

## Status

Accepted

## Context

Vehicle Sim needs a track authoring surface without making Three.js render meshes the physics source of truth. TrackPrint already provides a React editor plus pure TypeScript track geometry packages that compile authored spline, width, banking, curb, runoff, and terrain data.

## Decision

Integrate TrackPrint as a dedicated `/track-editor` route inside the existing Vite app. The editor may use React for its authoring UI, but the simulator remains driven by Vehicle Sim `WorldSpec` data. A Vehicle Sim adapter compiles TrackPrint documents into deterministic `TrackDefinition`/`WorldSpec` payloads rather than letting editor meshes become runtime collision authority.

## Consequences

- React and React DOM become editor-only runtime dependencies.
- The Vite app gains TSX support for the editor route.
- TrackPrint source is vendored into this repo so the project can build and test without a separate sibling checkout.
- Future work can promote exported TrackPrint payloads into committed track definitions once the format is stable.
