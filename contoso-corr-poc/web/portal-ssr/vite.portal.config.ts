import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "src/public",
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: "src/browser/portal-client.ts",
      formats: ["es"],
      fileName: () => "portal-client.js"
    }
  }
});
