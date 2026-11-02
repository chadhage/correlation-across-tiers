import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStorefrontBuild } from "./package-cohost.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(project, "deployment-artifact");

export async function validatePortalBuild(root) {
  const info = await lstat(root).catch(() => { throw new Error("CONTOSO_PORTAL_BUILD_REQUIRED"); });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("CONTOSO_UNSAFE_PORTAL_BUILD");
  await validateStorefrontBuild(resolve(root, "storefront"));
  const folders = new Set(["public", "shared", "browser", "storefront", "storefront/assets", "storefront/auth"]);
  const files = new Map();
  async function inspect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("CONTOSO_UNSAFE_PORTAL_BUILD");
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!folders.has(name)) throw new Error("CONTOSO_UNSAFE_PORTAL_BUILD");
        await inspect(path, name);
        continue;
      }
      const allowed = /^(?:bootstrap|browser-adapter|config|control-auth|gateway|server|telemetry)\.(?:js|d\.ts)$/.test(name)
        || /^(?:shared\/(?:browser-api|browser-telemetry|contracts|deadline|theme)|browser\/portal-client)\.(?:js|d\.ts)$/.test(name)
        || /^public\/(?:portal-client\.js|portal\.css)$/.test(name)
        || /^storefront\/(?:index\.html|auth\/redirect\.html|assets\/[A-Za-z0-9_.-]+\.(?:js|css|svg|png|ico|woff2))$/.test(name);
      if (!entry.isFile() || !allowed) throw new Error("CONTOSO_UNSAFE_PORTAL_BUILD");
      const bytes = await readFile(path);
      if (bytes.length > 16 * 1024 * 1024 || files.size >= 1000) throw new Error("CONTOSO_UNSAFE_PORTAL_BUILD");
      if (/InstrumentationKey=[0-9a-f-]{36}|Bearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(bytes.toString("utf8")))
        throw new Error("CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG");
      files.set(name, bytes);
    }
  }
  await inspect(root);
  for (const required of ["bootstrap.js", "server.js", "telemetry.js", "config.js", "control-auth.js", "gateway.js",
    "shared/contracts.js", "shared/deadline.js", "shared/theme.js", "public/portal-client.js", "public/portal.css"])
    if (!files.has(required)) throw new Error("CONTOSO_PORTAL_BUILD_REQUIRED");
  for (const [name, bytes] of files) {
    if (!name.endsWith(".js") || name.startsWith("public/") || name.startsWith("storefront/")) continue;
    for (const reference of bytes.toString("utf8").matchAll(/(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g)) {
      const path = resolve(root, dirname(name), reference[1]);
      if (!path.startsWith(`${resolve(root)}${sep}`) || !files.has(relative(root, path).split(sep).join("/")))
        throw new Error("CONTOSO_PORTAL_BUILD_REQUIRED");
    }
  }
  return { files: files.size, entries: files };
}

export async function packageDeployment() {
  const validated = await validatePortalBuild(resolve(project, "dist"));
  const source = JSON.parse(await readFile(resolve(project, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve(project, "package-lock.json"), "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""] || lock.packages[""].name !== source.name)
    throw new Error("CONTOSO_DEPLOYMENT_LOCK_INVALID");
  const manifest = { name: source.name, version: source.version, private: true, type: "module",
    engines: source.engines, scripts: { start: "node dist/bootstrap.js" }, dependencies: source.dependencies };
  lock.packages[""].dependencies = manifest.dependencies;
  delete lock.packages[""].devDependencies;
  await rm(target, { recursive: true, force: true });
  await mkdir(target);
  for (const [name, bytes] of validated.entries) {
    const path = resolve(target, "dist", name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  await writeFile(resolve(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(target, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  return { artifactRoot: target };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageDeployment();
  process.stdout.write("Contoso deployment-artifact contains production runtime and both surfaces; no tests, cache or resolved configuration.\n");
}
