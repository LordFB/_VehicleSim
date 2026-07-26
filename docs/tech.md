# Vehicle Sim Tech

## Stack

- Runtime: browser, Vite.
- Deployment target: Netlify.
- Language: TypeScript.
- Renderer: Three.js 0.184.
- Editor UI: React 18 for the TrackPrint `/track-editor` authoring route.
- Simulation: custom TypeScript physics runtime in a Web Worker.
- Tests: Vitest for unit/scenario coverage, Playwright for browser smoke checks.
- Online competition: Netlify Functions with a site-wide Netlify Blobs store.

## Architecture

- Physics owns vehicle transforms and surface contacts.
- Three.js builds visual track/vehicle/scenery objects from deterministic data.
- Race control derives lap validity from physics wheel-contact materials and reset events; the HUD only renders that state.
- Online leaderboard validation and persistence live behind the same-origin `/api/leaderboard` Netlify Function; local browser state is never storage authority.
- Leaderboard laps use immutable Blob keys and strong-consistency reads to avoid lost concurrent finishes. See ADR 0004.
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
