/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      // Same-origin `/api` in dev too, mirroring the Nginx proxy used in
      // production (Dockerfile + nginx.conf) — see src/net/ApiClient.ts.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    // `sim/` is the simulation shared by client and server; `server/` is the
    // Node game server. Both are covered by the same run as the client.
    include: ['src/**/*.test.ts', 'sim/**/*.test.ts', 'server/**/*.test.ts'],
    globals: true,
  },
});
