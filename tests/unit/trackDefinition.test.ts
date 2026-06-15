import { describe, expect, it } from 'vitest';
import { getTrackDefinition } from '../../src/level/tracks';
import { saveTrackPrintPreviewTrack } from '../../src/level/trackprintPreviewStorage';
import { createDefaultTrackDocument } from '@trackprint/test-fixtures';
import { createVehicleSimTrackFromTrackPrint } from '../../src/editor/trackprint/vehicleSimExport';

describe('track definitions', () => {
  it('keeps Monza as the default track', () => {
    const track = getTrackDefinition(new URLSearchParams(''));
    expect(track.id).toBe('monza');
    expect(track.displayName).toContain('Monza');
  });

  it('loads Nordschleife from the track query parameter', () => {
    const track = getTrackDefinition(new URLSearchParams('track=nordschleife'));
    expect(track.id).toBe('nordschleife');
    expect(track.displayName).toContain('Nordschleife');
    expect(track.centerline.length).toBeGreaterThan(1000);
  });

  it('loads the current TrackPrint editor preview from session storage', () => {
    const storage = new MemoryStorage();
    const preview = createVehicleSimTrackFromTrackPrint(createDefaultTrackDocument(), {
      displayName: 'Edited TrackPrint Layout',
    });
    saveTrackPrintPreviewTrack(preview, storage);

    const track = getTrackDefinition(new URLSearchParams('track=trackprint'), storage);
    expect(track.id).toBe('trackprint');
    expect(track.displayName).toBe('Edited TrackPrint Layout');
    expect(track.centerline.length).toBe(preview.centerline.length);
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
