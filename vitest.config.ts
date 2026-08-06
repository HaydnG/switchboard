import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
