import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
