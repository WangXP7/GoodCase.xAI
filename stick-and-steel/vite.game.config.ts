import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve('hosted'), envDir: resolve('.'), base: './', publicDir: resolve('public'),
  plugins: [react()], css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { alias: { '@': resolve('.'), 'next/link': resolve('hosted/link.tsx') } },
  build: { outDir: resolve('dist-game'), emptyOutDir: true, chunkSizeWarningLimit: 1800 },
});
