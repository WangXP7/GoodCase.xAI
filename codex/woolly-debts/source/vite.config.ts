import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022"
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  }
});
