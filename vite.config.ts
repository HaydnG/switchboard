import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Builds a single IIFE bundle injected into the legacy index.html.
// New UI mounts into #react-root alongside existing vanilla scripts.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/renderer/main.tsx'),
      name: 'SwitchboardUI',
      formats: ['iife'],
      fileName: () => 'react-app.js',
      cssFileName: 'react-app',
    },
    outDir: 'public/dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
});
