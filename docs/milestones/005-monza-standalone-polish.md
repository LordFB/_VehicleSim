# Milestone 005: Standalone Monza Geometry and Visual Polish

## Status

in-progress

## Objective

Turn `monza.html` into a smooth, reference-driven modern Monza showcase while preserving its surveyed 5,793 m plan shape and self-contained procedural approach. Remove camber-amplified drop-offs, terrain branch seams, and abrupt surface-width changes, then improve the circuit's parkland, safety infrastructure, surfaces, and permanent landmarks.

## Scope

- Replace the shelf-like approximate elevation controls with a broad, periodic Monza profile close to the documented 12.8 m relief.
- Smooth render tangents and crossfall, fade road camber outside the kerbs, and taper surface-width changes.
- Use continuous segment projection and a shared height query for the car, terrain, trees, and trackside objects.
- Refine asphalt, tricolore kerbs, runoff, barriers, fencing, broadleaf woodland, pit straight, old banking, and permanent Monza landmarks from current references.
- Add a standalone browser quality probe and visual smoke coverage.

## Out of scope

- Replacing the arcade demo car with the main Vehicle Sim physics runtime.
- Importing third-party circuit meshes, sponsor art, or copyrighted game assets.
- Changing the surveyed X/Z centreline footprint or official lap length.

## Dependencies

- **Depends on:** Milestone 004
- **Blocks:** none

## Acceptance criteria

- [ ] The standalone circuit remains 5,793 m and exposes a smooth periodic profile with approximately 12.8 m relief, maximum grade below 2%, and matching seam height/grade/bank. — test: `tests/e2e/monza-standalone.spec.ts::standalone Monza geometry quality stays within smoothness budgets`
- [ ] Bank slew is below 0.1 degrees per metre and no adjacent road-edge row changes height by more than 5 cm. — test: `tests/e2e/monza-standalone.spec.ts::standalone Monza geometry quality stays within smoothness budgets`
- [ ] Terrain no longer contains branch-switch cliffs and trees use the same terrain-height query as their bases. — test: `tests/e2e/monza-standalone.spec.ts::standalone Monza geometry quality stays within smoothness budgets`
- [ ] The page renders without console errors and includes modern Monza surface treatment, varied safety infrastructure, broadleaf parkland, pit/start detail, and preserved old-banking landmarks. — test: `tests/e2e/monza-standalone.spec.ts::standalone Monza renders its reference-driven detail pass`
- [ ] Chase/onboard driving through Rettifilo, Roggia, Lesmo, Serraglio, Ascari, and Alboreto reads as smooth and recognizably Monza. — verified by user playtest

## Exit condition

User opens `/monza.html`, watches or drives a full lap, and observes a clean, continuous road surface with no sudden height cliffs plus a substantially richer, recognizable modern Monza environment.

## Test plan

Write the standalone Playwright checks first and confirm they fail because the quality probe and reference-detail layer do not yet exist. After implementation, run the focused standalone browser test, `npm run build`, and the relevant existing Monza unit tests. Capture before/after screenshots from chase, high overview, and key circuit sectors; complete the final feel check by driving or observing a full AI lap.

## Notes

Reference baseline is the modern circuit after the 2024 resurfacing and kerb replacement. Permanent identity takes priority over season-specific sponsor branding: tricolore kerbs, Parco di Monza woodland, the historic oval, pit straight massing, the suspended podium, marshal/safety furniture, and the Alboreto `27`.
