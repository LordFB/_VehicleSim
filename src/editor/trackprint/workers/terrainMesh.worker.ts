import {
  generateSkirtMesh,
  generateTerrainMesh,
  type CorridorBoundary,
  type SkirtMeshData,
  type StationRangeSet,
  type TerrainDocument,
  type TerrainMeshData,
} from '@trackprint/terrain-core';

interface RebuildRequest {
  readonly id: number;
  readonly terrain: TerrainDocument;
  readonly boundary: CorridorBoundary;
  readonly blendWidth: number;
  readonly skirtSubdivisions: number;
  readonly skipSkirt?: boolean;
  readonly suppressLeft?: StationRangeSet;
  readonly suppressRight?: StationRangeSet;
}

interface RebuildResponse {
  readonly id: number;
  readonly terrainMesh: TerrainMeshData;
  readonly skirtMesh: SkirtMeshData | null;
}

self.addEventListener('message', (event: MessageEvent<RebuildRequest>) => {
  const { id, terrain, boundary, blendWidth, skirtSubdivisions, skipSkirt, suppressLeft, suppressRight } =
    event.data;
  const terrainMesh = generateTerrainMesh(terrain);
  const skirtMesh = skipSkirt
    ? null
    : generateSkirtMesh(terrain, boundary, blendWidth, skirtSubdivisions, suppressLeft, suppressRight);

  const transfer: Transferable[] = [
    terrainMesh.positions.buffer as ArrayBuffer,
    terrainMesh.normals.buffer as ArrayBuffer,
    terrainMesh.uvs.buffer as ArrayBuffer,
    terrainMesh.indices.buffer as ArrayBuffer,
  ];
  if (terrainMesh.colors) {
    transfer.push(terrainMesh.colors.buffer as ArrayBuffer);
  }
  if (skirtMesh) {
    transfer.push(
      skirtMesh.positions.buffer as ArrayBuffer,
      skirtMesh.normals.buffer as ArrayBuffer,
      skirtMesh.uvs.buffer as ArrayBuffer,
      skirtMesh.indices.buffer as ArrayBuffer,
    );
  }

  const response: RebuildResponse = { id, terrainMesh, skirtMesh };
  (self as unknown as Worker).postMessage(response, transfer);
});

export type { RebuildRequest, RebuildResponse };
