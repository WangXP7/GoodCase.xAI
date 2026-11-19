import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // (relative: the site also works under a path, as on GitHub Pages)
  server: { port: 5280 },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
