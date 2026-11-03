import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: ".cache/fixture-web",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL("./fixture-entry.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "fixture.js"
    },
    cssCodeSplit: false
  }
});
