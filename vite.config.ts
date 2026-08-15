/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      // Same-origin `/api` in dev too, mirroring the Nginx proxy used in
      // production (Dockerfile + nginx.conf) — see src/net/ApiClient.ts.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // Likewise for the game server's WebSocket, so the client can resolve one
      // same-origin URL in dev and in production instead of guessing a port.
      '/ws': { target: 'ws://localhost:8080', ws: true },
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
    /*
     * A handful of suites (matchStats, LocalSession, agency, siege) play whole
     * headless matches — up to 15000 ticks of the real sim with both sides
     * commanded. Those were already brushing the 5s default, and giving the
     * two supports an attack (GDD §8) added a fourth shooter per team, which
     * tipped them over. They are slow by design, not hung.
     */
    testTimeout: 30000,
  },
});
