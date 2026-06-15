# ADR 0001: Browser Three.js Vehicle Simulator

## Status

accepted

## Date

2026-06-14

## Context

The existing project is a Vite/TypeScript browser game with Three.js rendering and a custom vehicle physics runtime running through a Web Worker. The Nordschleife feature should extend this architecture, not replace it.

## Decision

Keep TypeScript, Vite, Three.js, and the existing worker-based custom physics runtime. Track work must flow through typed data and renderer/physics adapters rather than using render geometry as collision truth.

## Consequences

### Positive

- Preserves the current verified Monza and vehicle dynamics work.
- Keeps the project easy to run with one browser dev command.
- Allows deterministic generated track data and tests.

### Negative

- High-detail road surface support must be built into the current TypeScript physics runtime.
- Browser performance requires chunking and instancing for long circuits.

## Alternatives considered

- **Switch to Unity/Unreal:** rejected because it would discard the current browser stack.
- **Use ripped/scanned sim assets:** rejected for legal and project hygiene reasons.

## Related

- `docs/milestones/001-nordschleife.md`
