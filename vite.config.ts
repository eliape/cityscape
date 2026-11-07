import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  worker: { format: 'es' },
  // three.js alone is ~500 kB; one chunk is fine for this app.
  build: { chunkSizeWarningLimit: 900 },
  // Model runs are CPU-bound and test files run in parallel, so allow more than the default 5 s.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
