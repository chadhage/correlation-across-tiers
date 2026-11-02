import { cp, lstat, readFile, readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(project, "../storefront-spa/dist");
const destination = resolve(project, "dist/storefront");
export async function validateStorefrontBuild(root) {
  const info = await lstat(root).catch(() => { throw new Error("CONTOSO_STOREFRONT_BUILD_REQUIRED"); });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("CONTOSO_UNSAFE_STOREFRONT_BUILD");
  const html = await readFile(resolve(root, "index.html"), "utf8").catch(() => {
    throw new Error("CONTOSO_STOREFRONT_BUILD_REQUIRED");
  });
  if (html.split("<!--CONTOSO_RUNTIME_CONFIG-->").length !== 2 || /id\s*=\s*["']contoso-runtime-config["']/.test(html))
    throw new Error("CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG");
  const files = new Set();
  async function inspect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || /(?:^|\/)(?:\.cache|fixtures?|tests?|node_modules)(?:\/|$)/i.test(name)
        || name.endsWith(".map")) throw new Error("CONTOSO_UNSAFE_STOREFRONT_BUILD");
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) { await inspect(path, name); continue; }
      if (!entry.isFile() || !/^(?:index\.html|auth\/redirect\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|ico|woff2))$/.test(name))
        throw new Error("CONTOSO_UNSAFE_STOREFRONT_BUILD");
      const bytes = await readFile(path);
      if (bytes.length > 16 * 1024 * 1024 || files.size >= 1000) throw new Error("CONTOSO_UNSAFE_STOREFRONT_BUILD");
      if (/InstrumentationKey=[0-9a-f-]{36}|Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(bytes.toString("utf8")))
        throw new Error("CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG");
      files.add(name);
    }
  }
  await inspect(root);
  if (!files.has("auth/redirect.html")) throw new Error("CONTOSO_STOREFRONT_BUILD_REQUIRED");
  for (const path of ["index.html", "auth/redirect.html"]) {
    const content = await readFile(resolve(root, path), "utf8");
    const references = [...content.matchAll(/(?:src|href)=["'](\/storefront\/assets\/[^"'?#]+)["']/g)];
    if (references.length === 0 || references.some(match => !files.has(match[1].slice("/storefront/".length))))
      throw new Error("CONTOSO_STOREFRONT_BUILD_REQUIRED");
  }
  return { files: files.size };
}
export async function packageCohost() {
  await validateStorefrontBuild(source);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  process.stdout.write("Contoso leaf artifact includes Storefront assets; runtime configuration remains server-resolved.\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageCohost();
