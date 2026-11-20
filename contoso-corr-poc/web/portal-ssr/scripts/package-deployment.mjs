import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStorefrontBuild } from "./package-cohost.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profiles = new Set(["microsoft-distro", "spa-only"]);
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/;

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
      const allowed = /^(?:bootstrap|bootstrap-spa-only|browser-adapter|config|control-auth|gateway|server|telemetry)\.(?:js|d\.ts)$/.test(name)
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

export function validateSpaRuntimeLock(source, lock) {
  if (lock.lockfileVersion !== 3 || lock.packages?.[""]?.name !== source.name ||
      JSON.stringify(lock.packages[""].dependencies) !== JSON.stringify(source.dependencies) ||
      Object.entries(lock.packages).some(([location, item]) =>
        location && (!stableVersion.test(item.version ?? "") || !item.resolved || !item.integrity || item.dev || item.link)))
    throw new Error("CONTOSO_SPA_RUNTIME_LOCK_INVALID");
}

export function validateBrowserDependency(manifest, lock, location) {
  const entry = lock.packages?.[location];
  if (!entry || !entry.integrity || entry.version !== manifest.version || !stableVersion.test(manifest.version ?? ""))
    throw new Error("CONTOSO_BROWSER_DEPENDENCY_UNVERIFIED");
}

async function validateBrowserBuilds(entries) {
  const storefront = resolve(project, "../storefront-spa");
  const roots = [project, storefront];
  const locks = new Map(await Promise.all(roots.map(async root =>
    [root, JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"))])));
  const { build } = await import("vite");
  const audited = new Set();
  for (const [root, config, prefix] of [
    [storefront, "vite.config.ts", "storefront/"],
    [project, "vite.portal.config.ts", "public/"]
  ]) {
    let modules = 0;
    const result = await build({
      root, configFile: resolve(root, config), logLevel: "silent", build: { write: false },
      plugins: [{
        name: "contoso-audit-browser-dependencies",
        async generateBundle(_options, bundle) {
          const ids = new Set(Object.values(bundle).filter(entry => entry.type === "chunk")
            .flatMap(chunk => Object.keys(chunk.modules)));
          for (const id of ids) {
            const normalized = id.replaceAll("\\", "/").split("?")[0];
            const matches = [...normalized.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
            if (!matches.length) continue;
            const match = matches.at(-1);
            const packagePath = normalized.slice(0, match.index + match[0].length);
            const owner = roots.find(candidate => packagePath.startsWith(`${candidate.replaceAll("\\", "/")}/node_modules/`));
            if (!owner) throw new Error("CONTOSO_BROWSER_DEPENDENCY_UNVERIFIED");
            const location = relative(owner, packagePath).split(sep).join("/");
            const key = `${owner}\n${location}`;
            if (!audited.has(key)) {
              const manifest = JSON.parse(await readFile(resolve(packagePath, "package.json"), "utf8"));
              validateBrowserDependency(manifest, locks.get(owner), location);
              audited.add(key);
            }
            modules++;
          }
        }
      }]
    });
    if (!modules) throw new Error("CONTOSO_BROWSER_DEPENDENCY_UNVERIFIED");
    const output = (Array.isArray(result) ? result : [result]).flatMap(part => part.output);
    const actual = new Set();
    for (const item of output) {
      const name = `${prefix}${item.fileName}`;
      const bytes = Buffer.from(item.type === "chunk" ? item.code : item.source);
      if (actual.has(name) || !entries.get(name)?.equals(bytes)) throw new Error("CONTOSO_BROWSER_BUILD_DRIFT");
      actual.add(name);
    }
    if (prefix === "storefront/" && [...entries.keys()].some(name => name.startsWith(prefix) && !actual.has(name)))
      throw new Error("CONTOSO_BROWSER_BUILD_DRIFT");
    if (prefix === "public/" && !actual.has("public/portal-client.js")) throw new Error("CONTOSO_BROWSER_BUILD_DRIFT");
  }
}

export async function packageDeployment({ profile = "microsoft-distro", outputRoot, buildRoot = resolve(project, "dist") } = {}) {
  if (!profiles.has(profile)) throw new Error("CONTOSO_DEPLOYMENT_PROFILE_INVALID");
  const validated = await validatePortalBuild(buildRoot);
  const sourceRoot = profile === "spa-only" ? resolve(project, "profiles", "spa-only") : project;
  const source = JSON.parse(await readFile(resolve(sourceRoot, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(resolve(sourceRoot, "package-lock.json"), "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""] || lock.packages[""].name !== source.name)
    throw new Error("CONTOSO_DEPLOYMENT_LOCK_INVALID");
  if (profile === "spa-only") {
    validateSpaRuntimeLock(source, lock);
    if (!validated.entries.has("bootstrap-spa-only.js")) throw new Error("CONTOSO_PORTAL_BUILD_REQUIRED");
    await validateBrowserBuilds(validated.entries);
  }
  const target = outputRoot ? resolve(outputRoot) : profile === "spa-only"
    ? resolve(project, ".cache", "deployment-artifact-spa-only")
    : resolve(project, "deployment-artifact");
  const manifest = { name: source.name, version: source.version, private: true, type: "module",
    engines: source.engines, scripts: { start: `node dist/${profile === "spa-only" ? "bootstrap-spa-only" : "bootstrap"}.js` },
    dependencies: source.dependencies };
  lock.packages[""].dependencies = manifest.dependencies;
  delete lock.packages[""].devDependencies;
  if (!outputRoot && profile === "microsoft-distro") await rm(target, { recursive: true, force: true });
  if (!outputRoot && profile === "spa-only") await mkdir(dirname(target), { recursive: true });
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
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--profile=spa-only"))
    throw new Error("CONTOSO_DEPLOYMENT_PROFILE_INVALID");
  const profile = args.length ? "spa-only" : "microsoft-distro";
  await packageDeployment({ profile });
  process.stdout.write(profile === "spa-only"
    ? "Contoso SPA-only artifact checks its locked Node runtime and both browser bundles for prerelease versions; Portal SSR tracing and routes are disabled. Azure support and certification are not asserted.\n"
    : "Contoso deployment-artifact contains production runtime and both surfaces; no tests, cache or resolved configuration.\n");
}
