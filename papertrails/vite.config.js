import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5273, host: '127.0.0.1', open: false },
  preview: { port: 4273, host: '127.0.0.1', open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
});
