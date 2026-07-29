import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('application routing', () => {
  it('uses Monza as the clean-root entry without index.html', () => {
    expect(existsSync(new URL('../../index.html', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../../monza.html', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../../simulator.html', import.meta.url))).toBe(true);
    const vite = read('vite.config.ts');
    expect(vite).toContain("monzaRootPlugin");
    expect(vite).toContain("main: 'monza.html'");
    expect(vite).toContain("simulator: 'simulator.html'");
    expect(vite).not.toContain("main: 'index.html'");
    expect(read('netlify.toml')).toContain('to = "/monza.html"');
  });

  it('keeps TrackPrint and generic simulator navigation on simulator.html', () => {
    expect(read('simulator.html')).toContain('/src/main.ts');
    expect(read('src/editor/trackprint/App.tsx')).toContain("target.pathname = '/simulator.html'");
    expect(read('src/main.ts')).toContain("window.location.pathname === '/track-editor'");
  });
});
