import { defineConfig } from 'vitest/config';

/** Passe COMPLETE : tout, y compris `pipeline` et ses ~250 secondes de rendu. */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'test/_*.test.ts'],
    fileParallelism: false,
    testTimeout: 600000,
    hookTimeout: 600000,
  },
});
