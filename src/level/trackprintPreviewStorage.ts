import type { TrackDefinition } from './TrackDefinition';

export const TRACKPRINT_PREVIEW_STORAGE_KEY = 'vehicle-sim:trackprint-preview';
const TRACKPRINT_PREVIEW_DB = 'vehicle-sim-trackprint-preview';
const TRACKPRINT_PREVIEW_STORE = 'previews';
const TRACKPRINT_PREVIEW_RECORD = 'current';

export type TrackPrintPreviewStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveTrackPrintPreviewTrack(
  track: TrackDefinition,
  storage: TrackPrintPreviewStorage = window.sessionStorage,
): void {
  storage.setItem(TRACKPRINT_PREVIEW_STORAGE_KEY, JSON.stringify(track));
}

export async function saveTrackPrintPreviewTrackForBrowser(track: TrackDefinition): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!window.indexedDB) {
    saveTrackPrintPreviewTrack(track);
    return;
  }
  const db = await openPreviewDb();
  await putPreviewRecord(db, track);
  db.close();
  try {
    window.sessionStorage.removeItem(TRACKPRINT_PREVIEW_STORAGE_KEY);
  } catch {
    // Session storage may be unavailable in private browsing; IndexedDB already has the preview.
  }
}

export function loadTrackPrintPreviewTrack(
  storage: TrackPrintPreviewStorage | null = browserSessionStorage(),
): TrackDefinition | null {
  if (!storage) return null;
  const serialized = storage.getItem(TRACKPRINT_PREVIEW_STORAGE_KEY);
  if (!serialized) return null;

  try {
    const parsed = JSON.parse(serialized) as unknown;
    return isTrackDefinitionLike(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadTrackPrintPreviewTrackForBrowser(
  storage: TrackPrintPreviewStorage | null = browserSessionStorage(),
): Promise<TrackDefinition | null> {
  if (typeof window !== 'undefined' && window.indexedDB) {
    try {
      const db = await openPreviewDb();
      const record = await getPreviewRecord(db);
      db.close();
      if (isTrackDefinitionLike(record)) return record;
    } catch {
      // Fall back to the legacy sessionStorage path below.
    }
  }
  return loadTrackPrintPreviewTrack(storage);
}

function browserSessionStorage(): TrackPrintPreviewStorage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

function isTrackDefinitionLike(value: unknown): value is TrackDefinition {
  if (!isRecord(value)) return false;
  if (value.id !== 'trackprint') return false;
  if (typeof value.displayName !== 'string') return false;
  if (!Array.isArray(value.centerline) || value.centerline.length < 2) return false;
  if (!Array.isArray(value.trackPath) || value.trackPath.length < 2) return false;
  if (!isRecord(value.world) || !isRecord(value.spawn) || !isRecord(value.metadata)) return false;
  const world = value.world as Record<string, unknown>;
  return isRecord(world.terrainTrack) && Array.isArray((world.terrainTrack as Record<string, unknown>).samples);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function openPreviewDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(TRACKPRINT_PREVIEW_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACKPRINT_PREVIEW_STORE)) {
        db.createObjectStore(TRACKPRINT_PREVIEW_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open TrackPrint preview database.'));
  });
}

function putPreviewRecord(db: IDBDatabase, track: TrackDefinition): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACKPRINT_PREVIEW_STORE, 'readwrite');
    transaction.objectStore(TRACKPRINT_PREVIEW_STORE).put(track, TRACKPRINT_PREVIEW_RECORD);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save TrackPrint preview.'));
  });
}

function getPreviewRecord(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRACKPRINT_PREVIEW_STORE, 'readonly');
    const request = transaction.objectStore(TRACKPRINT_PREVIEW_STORE).get(TRACKPRINT_PREVIEW_RECORD);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to load TrackPrint preview.'));
  });
}
