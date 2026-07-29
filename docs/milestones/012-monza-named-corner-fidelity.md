# Milestone 012: Monza Named-Corner Fidelity

## Objective

Replace generic runoff patches around Monza with reference-driven, named-corner surface geometry that matches current aerial and trackside photography and is shared by rendering and physics.

## Scope

- Audit Rettifilo, Curva Grande/Biassono, Roggia, Lesmo 1/2, Serraglio, Ascari, and Curva Alboreto by corner name.
- Add deterministic polygonal asphalt, gravel, and painted runoff surfaces where the real circuit has them.
- Keep escape roads physically driveable and remove generic barriers that cross them.
- Preserve the OSM-derived racing centerline and physics-authoritative surface queries.

## Acceptance Criteria

- [ ] Variante del Rettifilo has a continuous straight-ahead asphalt escape road, an open barrier gap, asphalt physics contact, and no launch-inducing height seam at the racing-line join. Covered by `tests/unit/monzaCornerFidelity.test.ts` and `tests/unit/monzaVehicleSim.test.ts`; final appearance and driving feel require user playtest.
- [ ] Roggia, Lesmo, Ascari, and Alboreto runoff silhouettes are represented by named reference polygons rather than generic circles/rectangles. Covered by `tests/unit/monzaCornerFidelity.test.ts`; final appearance requires user playtest.
- [ ] Named-corner reference URLs and observations are committed with the deterministic feature data. Covered by `tests/unit/monzaCornerFidelity.test.ts`.
- [ ] Focused tests, production build, and browser capture pass without new console errors.

## Exit Condition

User drives or orbits each named Monza complex and sees the characteristic escape roads, gravel beds, painted runoff, and open safety corridors in the correct direction and relative position.
