import { useEffect, useRef, useState } from 'react';
import {
  generateSkirtMesh,
  generateTerrainMesh,
  type CorridorBoundary,
  type SkirtMeshData,
  type StationRangeSet,
  type TerrainDocument,
  type TerrainMeshData,
} from '@trackprint/terrain-core';
import type { RebuildResponse } from './workers/terrainMesh.worker';

export interface TerrainMeshResult {
  readonly terrainMesh: TerrainMeshData;
  readonly skirtMesh: SkirtMeshData;
  readonly pending: boolean;
}

interface TerrainMeshOptions {
  readonly blendWidth: number;
  readonly skirtSubdivisions: number;
  readonly suppressLeft?: StationRangeSet;
  readonly suppressRight?: StationRangeSet;
}

interface PendingRequest {
  readonly terrain: TerrainDocument;
  readonly boundary: CorridorBoundary;
}

export function useTerrainMeshWorker(
  terrain: TerrainDocument,
  boundary: CorridorBoundary,
  options: TerrainMeshOptions,
): TerrainMeshResult {
  const [state, setState] = useState<TerrainMeshResult>(() => {
    const terrainMesh = generateTerrainMesh(terrain);
    const skirtMesh = generateSkirtMesh(
      terrain,
      boundary,
      options.blendWidth,
      options.skirtSubdivisions,
      options.suppressLeft,
      options.suppressRight,
    );
    return { terrainMesh, skirtMesh, pending: false };
  });

  const workerRef = useRef<Worker | null>(null);
  const inFlightRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const idCounterRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (typeof Worker === 'undefined') {
      return;
    }

    const worker = new Worker(new URL('./workers/terrainMesh.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.addEventListener('message', (event: MessageEvent<RebuildResponse>) => {
      const { id, terrainMesh, skirtMesh } = event.data;
      if (inFlightRef.current !== id) {
        return;
      }
      inFlightRef.current = null;

      const next = pendingRef.current;
      if (next) {
        pendingRef.current = null;
        dispatch(next.terrain, next.boundary);
        return;
      }

      if (skirtMesh) {
        setState({ terrainMesh, skirtMesh, pending: false });
      }
    });

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      inFlightRef.current = null;
      pendingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = (target: TerrainDocument, edge: CorridorBoundary) => {
    const worker = workerRef.current;
    if (!worker) {
      const terrainMesh = generateTerrainMesh(target);
      const skirtMesh = generateSkirtMesh(
        target,
        edge,
        optionsRef.current.blendWidth,
        optionsRef.current.skirtSubdivisions,
        optionsRef.current.suppressLeft,
        optionsRef.current.suppressRight,
      );
      setState({ terrainMesh, skirtMesh, pending: false });
      return;
    }

    setState({ terrainMesh: emptyTerrainMesh(), skirtMesh: emptySkirtMesh(), pending: true });

    if (inFlightRef.current !== null) {
      pendingRef.current = { terrain: target, boundary: edge };
      return;
    }

    idCounterRef.current += 1;
    const id = idCounterRef.current;
    inFlightRef.current = id;
    worker.postMessage({
      id,
      terrain: target,
      boundary: edge,
      blendWidth: optionsRef.current.blendWidth,
      skirtSubdivisions: optionsRef.current.skirtSubdivisions,
      suppressLeft: optionsRef.current.suppressLeft,
      suppressRight: optionsRef.current.suppressRight,
    });
  };

  useEffect(() => {
    dispatch(terrain, boundary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, boundary]);

  return state;
}

function emptyTerrainMesh(): TerrainMeshData {
  return {
    positions: new Float32Array(),
    normals: new Float32Array(),
    uvs: new Float32Array(),
    indices: new Uint32Array(),
    colors: new Float32Array(),
    materialIds: [],
  };
}

function emptySkirtMesh(): SkirtMeshData {
  return {
    ...emptyTerrainMesh(),
    seam: [],
  };
}
