// Reference material attached to a project to help author a track: image files
// (course maps, photos, scanned layouts), API/data payloads or links (timing
// data, OSM extracts, elevation JSON), and free-form notes. References are
// authoring aids only — they do not affect the compiled track or terrain.

export type ReferenceKind = 'image' | 'data' | 'link' | 'note';

export interface ReferenceItem {
  readonly id: string;
  readonly kind: ReferenceKind;
  /** Display name (file name, link title, or note heading). */
  readonly name: string;
  /** Optional free-text annotation. */
  readonly note?: string;
  /**
   * Inline payload. For 'image' a data URL; for 'data' the raw text/JSON; for
   * 'link' the URL; for 'note' the body text. Kept inline so references travel
   * with the saved project.
   */
  readonly content: string;
  /** Original MIME type for file-backed references. */
  readonly mimeType?: string;
  /** Byte size for file-backed references, for display. */
  readonly sizeBytes?: number;
  readonly addedAt: number;
}

let counter = 0;

export function createReferenceId(): string {
  counter += 1;
  return `ref-${Date.now().toString(36)}-${counter}`;
}

// Build an image reference straight from a data URL (e.g. a fetched satellite
// canvas via canvas.toDataURL()) rather than a picked File.
export function createImageReference(dataUrl: string, name: string): ReferenceItem {
  return {
    id: createReferenceId(),
    kind: 'image',
    name,
    content: dataUrl,
    mimeType: 'image/png',
    addedAt: Date.now(),
  };
}

// Build a data reference from raw text/JSON (e.g. a fetched elevation grid).
export function createDataReference(content: string, name: string, note?: string): ReferenceItem {
  return {
    id: createReferenceId(),
    kind: 'data',
    name,
    note,
    content,
    mimeType: 'application/json',
    sizeBytes: content.length,
    addedAt: Date.now(),
  };
}

export function createLinkReference(url: string, name?: string): ReferenceItem {
  const trimmed = url.trim();
  return {
    id: createReferenceId(),
    kind: 'link',
    name: name?.trim() || trimmed || 'Link',
    content: trimmed,
    addedAt: Date.now(),
  };
}

export function createNoteReference(body: string, name?: string): ReferenceItem {
  return {
    id: createReferenceId(),
    kind: 'note',
    name: name?.trim() || 'Note',
    content: body,
    addedAt: Date.now(),
  };
}

// Read a picked File into an inline reference. Images become data URLs (so they
// can be previewed/draped later); text-like files are stored as decoded text;
// anything else falls back to a data URL.
export function readFileReference(file: File): Promise<ReferenceItem> {
  const isImage = file.type.startsWith('image/');
  const isText =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    /\.(json|csv|txt|gpx|geojson|kml|xml)$/i.test(file.name);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      resolve({
        id: createReferenceId(),
        kind: isImage ? 'image' : 'data',
        name: file.name,
        content: typeof reader.result === 'string' ? reader.result : '',
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        addedAt: Date.now(),
      });
    };
    if (isImage || !isText) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes && bytes !== 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
