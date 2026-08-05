import { defineConfig } from 'vite';

/**
 * Bundles the Node game server (`server/src/main.ts`) into a single ESM file.
 *
 * Using Vite here rather than `tsc` is deliberate: the server imports the same
 * extensionless-specifier TypeScript the client does, plus the map JSON under
 * `public/maps/` — a bundler resolves both, where `tsc` output would need
 * rewritten import paths and a runtime file read. `ws` and Node builtins stay
 * external, so the production image just needs `npm ci --omit=dev`.
 */
export default defineConfig({
  build: {
    ssr: 'server/src/main.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    // Match the map JSON into the bundle rather than emitting it as an asset.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: { entryFileNames: 'main.js', format: 'esm' },
    },
  },
  ssr: {
    external: ['ws'],
  },
});
