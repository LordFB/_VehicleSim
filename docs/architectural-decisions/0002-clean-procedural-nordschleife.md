# ADR 0002: Clean Procedural Nordschleife

## Status

accepted

## Date

2026-06-14

## Context

The user wants a high-detail Nordschleife in the existing simulator. The selected detail target is a clean procedural reconstruction, not licensed scan-grade data.

## Decision

Build Nordschleife from committed OpenStreetMap-derived way geometry, procedural macro elevation, authored camber/crest/kerb metadata, and instanced scenery. Runtime must not fetch external data.

## Consequences

### Positive

- Keeps the data auditable and legally usable with attribution.
- Enables deterministic tests and screenshots.
- Provides elevation, camber, named sectors, barriers, and scenery without depending on licensed survey data.

### Negative

- The result is not laser-scan accurate.
- Some road detail is authored/procedural instead of measured.

## Alternatives considered

- **Licensed scan-grade source:** deferred because it introduces cost and dependency risk.
- **Fast flat OSM loop:** rejected because Nordschleife needs elevation and crests to feel meaningful.

## Related

- OpenStreetMap attribution: https://www.openstreetmap.org/copyright
- `docs/milestones/001-nordschleife.md`
