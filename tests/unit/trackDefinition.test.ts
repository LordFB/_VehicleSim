import { describe, expect, it } from 'vitest';
import { getTrackDefinition } from '../../src/level/tracks';

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
});
