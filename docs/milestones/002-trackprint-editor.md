# Milestone 002: TrackPrint Editor Integration

## Objective

Integrate the TrackPrint circuit editor into Vehicle Sim as a dedicated in-app editor route and let the user race the normal sim car on the currently edited track.

## Scope

- Import TrackPrint editor and geometry packages into this project.
- Expose a `/track-editor` route from the existing Vite app.
- Add an adapter that compiles TrackPrint documents into Vehicle Sim `TrackDefinition`/`WorldSpec` data.
- Add an editor-to-simulator handoff for the current edited track.
- Add a `.tp` binary package format that carries the source project, compiled sim track, terrain meshes/collision, and imported real-world terrain texture bytes.
- Let the running simulator accept dropped `.tp` packages and load them through the TrackPrint preview path.
- Verify the default simulator route remains unchanged.

## Acceptance Criteria

- [x] `/track-editor` renders the TrackPrint editor UI without booting the driving simulator. Covered by `tests/e2e/app.spec.ts`.
- [x] `/` still boots the Vehicle Sim driving runtime. Covered by `tests/e2e/app.spec.ts`.
- [x] A TrackPrint document can be converted into Vehicle Sim terrain-track samples, checkpoints, bounds, spawn, and surface data. Covered by `tests/unit/trackprintVehicleSimExport.test.ts`.
- [x] The editor can launch the simulator on the currently edited TrackPrint track through `?track=trackprint`. Covered by `tests/unit/trackDefinition.test.ts`; browser handoff covered by `tests/e2e/app.spec.ts`.
- [x] TrackPrint projects can be saved as reloadable `.tp` binary packages with source project data, compiled Vehicle Sim track data, terrain mesh/collision payloads, and imported terrain texture bytes. Covered by `tests/unit/trackprintPackage.test.ts`.
- [x] Decoded `.tp` packages can feed the existing TrackPrint preview loader used by the simulator. Covered by `tests/unit/trackprintPackage.test.ts`.
- [x] Build and focused TrackPrint tests pass. Verified with `npm run build` and `npm test -- tests/unit/trackprintPackage.test.ts tests/unit/trackprintVehicleSimExport.test.ts tests/unit/trackDefinition.test.ts`.

## Exit Condition

User can open `/track-editor`, author or load a TrackPrint project, click Race, and drive the normal Vehicle Sim car on that edited layout without route or build errors.
