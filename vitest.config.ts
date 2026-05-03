import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-integration.ts'],
    // Integration tests share a database and must run serially
    fileParallelism: false,
  },
});
