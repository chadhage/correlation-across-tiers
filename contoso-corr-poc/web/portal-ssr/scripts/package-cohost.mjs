import { cp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(project, "../storefront-spa/dist");
const destination = resolve(project, "dist/storefront");
const html = await readFile(resolve(source, "index.html"), "utf8").catch(() => {
  throw new Error("CONTOSO_STOREFRONT_BUILD_REQUIRED");
});
if (!html.includes("<!--CONTOSO_RUNTIME_CONFIG-->") || html.includes('id="contoso-runtime-config"'))
  throw new Error("CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG");
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
process.stdout.write("Contoso leaf artifact includes Storefront assets; runtime configuration remains server-resolved.\n");
