# Milestone 004: High-Detail Monza Environment

## Objective

Make the default Monza circuit feel more like Autodromo Nazionale Monza inside Parco di Monza by adding reference-driven visual detail, species-aware tree billboards, and optimized instancing/culling without changing physics authority.

## Scope

- Add Monza-specific detail feature data for grandstands, pit buildings, service roads, fencing, marshal posts, painted runoff, braking boards, and the old banked oval context.
- Add committed OpenTopo-derived elevation samples and apply them as a smoothed Monza terrain profile.
- Replace generic conifer-style forest visuals with billboarded broadleaf species matching Parco di Monza flora references.
- Keep all repeated scenery and trackside details instanced and split into cullable chunks.
- Preserve deterministic placement from committed data and seeded generation.

## Acceptance Criteria

- [x] Monza track definition exposes high-detail feature metadata for built structures, service roads, fencing, runoff paint, braking boards, and species-aware forest billboards. Covered by `tests/unit/monzaDetail.test.ts`.
- [x] Monza carries committed OpenTopo SRTM elevation data and a non-flat, normalized terrain profile shared by physics and visuals. Covered by `tests/unit/monzaDetail.test.ts`.
- [x] Scenery builds billboarded tree chunks with multiple Parco di Monza species and no per-tree mesh leaks. Covered by `tests/unit/scenery.test.ts`.
- [x] Repeated circuit details render through instanced meshes with bounded draw groups and culling enabled. Covered by `tests/unit/monzaDetail.test.ts`.
- [x] Build and focused Monza/scenery tests pass. Verified with `npm test -- tests/unit/monzaDetail.test.ts tests/unit/scenery.test.ts`, `npm run build`, and `node scripts/monza-smoke.mjs http://127.0.0.1:3173 --spawn-vite`.

## Exit Condition

User can open the default Monza track and see denser, more recognizable Monza surroundings: broadleaf park woodland, pit and grandstand massing, green/white/red runoff zones, braking boards, fences, service roads, and the preserved banked oval detail, with stable performance from instancing and culling.
