# Vehicle Sim Tech

## Stack

- Runtime: browser, Vite.
- Language: TypeScript.
- Renderer: Three.js 0.184.
- Simulation: custom TypeScript physics runtime in a Web Worker.
- Tests: Vitest for unit/scenario coverage, Playwright for browser smoke checks.

## Architecture

- Physics owns vehicle transforms and surface contacts.
- Three.js builds visual track/vehicle/scenery objects from deterministic data.
- `WorldSpec` describes materials, surface zones, barriers, and optional terrain-backed track data.
- Repeated scenery and barriers should use `InstancedMesh` when possible.

## Commands

- Dev server: `npm run dev`
- Build: `npm run build`
- Unit/scenario tests: `npm test`
- E2E smoke tests: `npm run test:e2e`

## Data Policy

- OpenStreetMap-derived geometry must include attribution and ODbL notes.
- DEM/elevation detail may be procedural or from open sources with attribution.
- Generated track data is committed so runtime does not require network access.
