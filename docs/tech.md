# Vehicle Sim Tech

## Stack

- Runtime: browser, Vite.
- Language: TypeScript.
- Renderer: Three.js 0.184.
- Editor UI: React 18 for the TrackPrint `/track-editor` authoring route.
- Simulation: custom TypeScript physics runtime in a Web Worker.
- Tests: Vitest for unit/scenario coverage, Playwright for browser smoke checks.

## Architecture

- Physics owns vehicle transforms and surface contacts.
- Three.js builds visual track/vehicle/scenery objects from deterministic data.
- `WorldSpec` describes materials, surface zones, barriers, and optional terrain-backed track data.
- TrackPrint editor documents compile through an adapter into deterministic `TrackDefinition`/`WorldSpec` data; editor meshes are not physics authority.
- Repeated scenery and barriers should use `InstancedMesh` when possible.

## Commands

- Dev server: `npm run dev`
- Build: `npm run build`
- Unit/scenario tests: `npm test`
- E2E smoke tests: `npm run test:e2e`

## Data Policy

- OpenStreetMap-derived geometry must include attribution and ODbL notes.
- DEM/elevation detail may be procedural or from open sources with attribution.
- OpenTopography/OpenTopo-derived DEM samples may be committed as deterministic JSON when the source, fetch date, dataset, and regeneration script are included.
- Generated track data is committed so runtime does not require network access.
