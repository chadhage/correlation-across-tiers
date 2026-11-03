import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/storefront/",
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        storefront: fileURLToPath(new URL("./index.html", import.meta.url)),
        redirect: fileURLToPath(new URL("./auth/redirect.html", import.meta.url))
      }
    }
  }
});
