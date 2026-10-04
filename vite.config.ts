import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The dev server advertises a loopback MCP endpoint, exactly like the desktop
 * app's bundled server (docs/DESKTOP.md). A developer's machine is one of the
 * two places MCP ships, so the panel behaves the same here as it does there; a
 * hosted deployment serves no /config.json at all and the panel is gated.
 */
function devMcpAdvertisement(): Plugin {
  const config = {
    schema: 'pigma/config/1',
    name: 'pigma-dev',
    version: '0.1.0',
    mode: 'loopback',
    mcp: { enabled: true, url: 'http://127.0.0.1:3001/mcp', tokenRequired: false, stdioAvailable: true },
    relay: { url: 'ws://127.0.0.1:5173/relay', tokenRequired: false, e2e: true },
  };
  return {
    name: 'pigma-dev-mcp-advertisement',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url || !request.url.startsWith('/config.json')) return next();
        response.setHeader('content-type', 'application/json');
        response.end(`${JSON.stringify(config, null, 2)}\n`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devMcpAdvertisement()],
  server: {
    // Bind IPv4 explicitly: on IPv6-first machines Vite otherwise listens on
    // [::1] only, which breaks the Playwright readiness probe on 127.0.0.1.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // A Cloudflare quick tunnel reaches the dev server for live review.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
