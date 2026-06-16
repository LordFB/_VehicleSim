import type { TrackPrintProject } from '../editor/trackprint/project';
import type { TrackDefinition } from './TrackDefinition';

export const TRACKPRINT_PACKAGE_EXTENSION = '.tp';
export const TRACKPRINT_PACKAGE_MIME = 'application/x-trackprint-package';

const MAGIC = 'TPKG';
const VERSION = 1;
const HEADER_BYTES = 16;
const FORMAT_ID = 'vehicle-sim.trackprint-package';

export type TrackPrintPackageAssetRole = 'terrain-texture' | 'reference' | 'other';

export interface TrackPrintPackageAsset {
  readonly id: string;
  readonly role: TrackPrintPackageAssetRole;
  readonly mimeType: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly width?: number;
  readonly height?: number;
}

export interface TrackPrintPackage {
  readonly project: TrackPrintProject;
  readonly track: TrackDefinition;
  readonly assets: readonly TrackPrintPackageAsset[];
}

interface TrackPrintPackageManifest {
  readonly format: typeof FORMAT_ID;
  readonly version: typeof VERSION;
  readonly createdAt: string;
  readonly project: TrackPrintProject;
  readonly track: TrackDefinition;
  readonly assets: readonly TrackPrintPackageAssetManifest[];
}

interface TrackPrintPackageAssetManifest {
  readonly id: string;
  readonly role: TrackPrintPackageAssetRole;
  readonly mimeType: string;
  readonly name: string;
  readonly byteLength: number;
  readonly width?: number;
  readonly height?: number;
}

export function encodeTrackPrintPackage(input: TrackPrintPackage): Uint8Array {
  const manifest: TrackPrintPackageManifest = {
    format: FORMAT_ID,
    version: VERSION,
    createdAt: new Date(0).toISOString(),
    project: input.project,
    track: stripRuntimeTexture(input.track),
    assets: input.assets.map((asset) => ({
      id: asset.id,
      role: asset.role,
      mimeType: asset.mimeType,
      name: asset.name,
      byteLength: asset.bytes.byteLength,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const payloadBytes = input.assets.reduce((total, asset) => total + 4 + asset.bytes.byteLength, 0);
  const bytes = new Uint8Array(HEADER_BYTES + json.byteLength + payloadBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  bytes.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, json.byteLength, true);
  view.setUint32(12, input.assets.length, true);
  bytes.set(json, HEADER_BYTES);

  let cursor = HEADER_BYTES + json.byteLength;
  for (const asset of input.assets) {
    view.setUint32(cursor, asset.bytes.byteLength, true);
    cursor += 4;
    bytes.set(asset.bytes, cursor);
    cursor += asset.bytes.byteLength;
  }

  return bytes;
}

export function decodeTrackPrintPackage(bytes: Uint8Array | ArrayBuffer): TrackPrintPackage {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isTrackPrintPackageBytes(source)) {
    throw new Error('File is not a TrackPrint .tp package.');
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`Unsupported TrackPrint package version ${version}.`);
  }

  const jsonLength = view.getUint32(8, true);
  const assetCount = view.getUint32(12, true);
  const manifestEnd = HEADER_BYTES + jsonLength;
  if (jsonLength <= 0 || manifestEnd > source.byteLength) {
    throw new Error('TrackPrint package manifest is truncated.');
  }

  const manifest = JSON.parse(new TextDecoder().decode(source.slice(HEADER_BYTES, manifestEnd))) as TrackPrintPackageManifest;
  if (manifest.format !== FORMAT_ID || manifest.version !== VERSION) {
    throw new Error('TrackPrint package manifest is invalid.');
  }
  if (manifest.assets.length !== assetCount) {
    throw new Error('TrackPrint package asset table does not match its header.');
  }

  const assets: TrackPrintPackageAsset[] = [];
  let cursor = manifestEnd;
  for (const metadata of manifest.assets) {
    if (cursor + 4 > source.byteLength) {
      throw new Error(`TrackPrint package asset ${metadata.id} is missing its length prefix.`);
    }
    const byteLength = view.getUint32(cursor, true);
    cursor += 4;
    const end = cursor + byteLength;
    if (end > source.byteLength) {
      throw new Error(`TrackPrint package asset ${metadata.id} is truncated.`);
    }
    if (byteLength !== metadata.byteLength) {
      throw new Error(`TrackPrint package asset ${metadata.id} length does not match the manifest.`);
    }
    assets.push({
      id: metadata.id,
      role: metadata.role,
      mimeType: metadata.mimeType,
      name: metadata.name,
      bytes: source.slice(cursor, end),
      ...(metadata.width !== undefined ? { width: metadata.width } : {}),
      ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    });
    cursor = end;
  }
  if (cursor !== source.byteLength) {
    throw new Error('TrackPrint package contains trailing bytes.');
  }

  return {
    project: manifest.project,
    track: injectRuntimeTexture(manifest.track, assets),
    assets,
  };
}

export function isTrackPrintPackageBytes(bytes: Uint8Array): boolean {
  return bytes.byteLength >= HEADER_BYTES && new TextDecoder().decode(bytes.slice(0, 4)) === MAGIC;
}

function stripRuntimeTexture(track: TrackDefinition): TrackDefinition {
  if (!track.features.trackPrintTerrainTexture) return track;
  const { trackPrintTerrainTexture: _texture, ...features } = track.features;
  return { ...track, features };
}

function injectRuntimeTexture(track: TrackDefinition, assets: readonly TrackPrintPackageAsset[]): TrackDefinition {
  const texture = assets.find((asset) => asset.role === 'terrain-texture');
  if (!texture) return track;
  return {
    ...track,
    features: {
      ...track.features,
      trackPrintTerrainTexture: {
        mimeType: texture.mimeType,
        dataUrl: `data:${texture.mimeType};base64,${bytesToBase64(texture.bytes)}`,
        ...(texture.width !== undefined ? { width: texture.width } : {}),
        ...(texture.height !== undefined ? { height: texture.height } : {}),
      },
    },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
