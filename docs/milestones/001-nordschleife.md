# Milestone 001: High-Detail Nordschleife

## Objective

Add a clean procedural Nordschleife track that can be selected with `?track=nordschleife` while preserving Monza as the default.

## Scope

- Track abstraction for Monza and Nordschleife.
- Generated Nordschleife centerline, surface data, checkpoints, barriers, minimap, and feature metadata.
- Terrain-backed surface queries with height and normals.
- High-detail generated road, terrain corridor, and Armco visual meshes.
- Oriented barriers and instanced visual guardrails/posts.
- Browser/unit verification for selected track behavior.

## Acceptance Criteria

- [x] `?track=nordschleife` loads Nordschleife and default/no query still loads Monza. Covered by `tests/unit/trackDefinition.test.ts` and `tests/e2e/app.spec.ts`.
- [x] Nordschleife generated lap length is near 20.832 km in real-scale metadata. Covered by `tests/unit/nordschleife.test.ts`.
- [x] Surface queries return asphalt on the centerline, grass off-track, and valid non-flat normals on elevated sections. Covered by `tests/unit/nordschleife.test.ts`.
- [x] Oriented barriers follow track edges without intruding onto the road. Covered by `tests/unit/nordschleife.test.ts`.
- [x] Renderer shows detailed road, shoulders, terrain corridor, kerbs, Armco rails/posts, trees, and named landmark signs with bounded draw calls. Covered by `tests/unit/generatedTrackMeshes.test.ts`; previously smoke-tested by `npm run test:e2e` and `node scripts/nordschleife-verify.mjs`.
- [x] Off-track generated terrain has collision/height queries instead of falling back to a flat grass plane. Covered by `tests/unit/nordschleife.test.ts`.
- [x] Build, unit tests, and e2e smoke tests pass. Verified with `npm run build`, `npm test`, `npm run test:e2e`, and `node scripts/nordschleife-verify.mjs`.

## Exit Condition

User can open `/?track=nordschleife`, shift into first with `E`, drive from the start line, see the minimap and landmarks, and stay on a high-detail elevated Nordschleife road without console errors.
