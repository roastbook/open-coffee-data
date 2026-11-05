import { defineConfig } from "astro/config";

// scripts/build.sh builds into the repository's dist/ and then adds datasets/, assets/ and artifacts/.
export default defineConfig({
  site: "https://data.roastbook.coffee",
  outDir: process.env.SITE_OUT_DIR ?? "../dist",
  trailingSlash: "always",
  build: { format: "directory" },
  // MapLibre GL is one ~800 KB chunk by design; only the Explorer page loads it.
  vite: { build: { chunkSizeWarningLimit: 1200 } },
});
