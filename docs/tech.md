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

- `/` and `/monza.html` resolve to the Monza application shell; `/simulator.html` hosts the legacy generic simulator and `/track-editor` rewrites to that shell.
- Monza flow uses a typed transition-table state machine. Each scene owns an `enter`/`exit` lifecycle so returning to the menu disposes workers, listeners, audio, and renderer resources.
- Physics owns vehicle transforms and surface contacts.
- Three.js builds visual track/vehicle/scenery objects from deterministic data.
- The race worker owns deterministic multi-car state, AI control, full player physics, lightweight AI tire dynamics, chassis contact, and batched race snapshots. Camera focus never affects simulation fidelity. See ADR 0005.
- The race worker also owns component damage and translates it into model-neutral vehicle effects consumed by both physics implementations. See ADR 0006.
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
