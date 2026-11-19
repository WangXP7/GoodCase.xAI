import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
  server: { port: 5173, strictPort: true },
});
