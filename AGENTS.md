# AGENTS.md

Read this first in every agent session.

## Project Overview

- Title: Vehicle Sim
- Pitch: Browser-based hardcore vehicle dynamics sandbox with telemetry, setup tuning, and real/procedural circuit layouts.
- Engine: Vite + Three.js 0.184.
- Language: TypeScript.
- Target platform: desktop browser.

## Source Of Truth

- `docs/STATE.md`
- `docs/gameplan.md`
- `docs/tech.md`
- `docs/milestones/`
- `docs/architectural-decisions/`

## Working Rules

- Follow the `make-game` development workflow when available.
- Keep physics as the source of truth; Three.js renders snapshots and deterministic track data.
- Do not import ripped or copyrighted game assets.
- Add tests for checkable acceptance criteria before or alongside implementation.
- Update `docs/STATE.md` after meaningful progress.

## Commands

- Dev server: `npm run dev`
- Build: `npm run build`
- Tests: `npm test`
- E2E: `npm run test:e2e`

## Last Regenerated

2026-06-14 by Codex
