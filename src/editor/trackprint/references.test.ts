import { describe, expect, it } from 'vitest';
import {
  createLinkReference,
  createNoteReference,
  formatBytes,
  readFileReference,
} from './references';

describe('references', () => {
  it('creates a link reference, defaulting the name to the url', () => {
    const ref = createLinkReference('https://example.com/track.geojson');
    expect(ref.kind).toBe('link');
    expect(ref.name).toBe('https://example.com/track.geojson');
    expect(ref.content).toBe('https://example.com/track.geojson');
    expect(ref.id).toMatch(/^ref-/);
  });

  it('uses an explicit link name when given', () => {
    const ref = createLinkReference('https://maps.example/x', 'Course map');
    expect(ref.name).toBe('Course map');
  });

  it('creates a note reference with a default name', () => {
    const ref = createNoteReference('Turn 3 is off-camber.');
    expect(ref.kind).toBe('note');
    expect(ref.name).toBe('Note');
    expect(ref.content).toBe('Turn 3 is off-camber.');
  });

  it('reads an image file as a data URL', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'map.png', { type: 'image/png' });
    const ref = await readFileReference(file);
    expect(ref.kind).toBe('image');
    expect(ref.name).toBe('map.png');
    expect(ref.mimeType).toBe('image/png');
    expect(ref.content.startsWith('data:image/png')).toBe(true);
  });

  it('reads a json file as decoded text', async () => {
    const file = new File(['{"a":1}'], 'data.json', { type: 'application/json' });
    const ref = await readFileReference(file);
    expect(ref.kind).toBe('data');
    expect(ref.content).toBe('{"a":1}');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(undefined)).toBe('');
  });
});
