import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    minify: "terser",
    // Limit property shortening to one React cache implementation field.
    terserOptions: { mangle: { properties: { regex: /^p[o]{2}l$/ } } },
    chunkSizeWarningLimit: 1200,
  },
  server: { host: "0.0.0.0" },
});
