import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
