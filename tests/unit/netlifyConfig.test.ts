import { describe, expect, it } from 'vitest';
import config from '../../netlify.toml?raw';
import functionSource from '../../netlify/functions/leaderboard.ts?raw';

describe('Netlify deployment configuration', () => {
  it('builds Vite, publishes dist, discovers functions, and configures the leaderboard route', () => {
    expect(config).toContain('command = "npm run build"');
    expect(config).toContain('publish = "dist"');
    expect(config).toContain('directory = "netlify/functions"');
    expect(functionSource).toContain("path: '/api/leaderboard'");
    expect(functionSource).toContain('rateLimit:');
    expect(functionSource).toContain("aggregateBy: ['ip', 'domain']");
  });
});
