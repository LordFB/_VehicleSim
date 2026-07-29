import { defineConfig, type Plugin } from 'vite';

export function monzaRootPlugin(): Plugin {
  const rewrite = (url: string | undefined): string | undefined => {
    if (!url) return url;
    const [pathname, query] = url.split('?', 2);
    const suffix = query ? `?${query}` : '';
    if (pathname === '/') return `/monza.html${suffix}`;
    if (pathname === '/track-editor') return `/simulator.html${suffix}`;
    return url;
  };
  const install = (middlewares: {
    use(handler: (request: { url?: string }, response: unknown, next: () => void) => void): void;
  }) => {
    middlewares.use((request, _response, next) => {
      request.url = rewrite(request.url);
      next();
    });
  };
  return {
    name: 'vehicle-sim-monza-root',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [monzaRootPlugin()],
  server: {
    port: 3000,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'monza.html',
        simulator: 'simulator.html',
      },
    },
  },
});
