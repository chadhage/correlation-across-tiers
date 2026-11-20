import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { validateStorefrontBuild } from "../scripts/package-cohost.mjs";
import { packageDeployment, validateBrowserDependency, validatePortalBuild, validateSpaRuntimeLock } from "../scripts/package-deployment.mjs";

test("LOCAL cohost packaging validates the actual runtime-free build and refuses incomplete or unsafe payloads", async () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const actual = resolve(project, "..", "storefront-spa", "dist");
  assert.ok((await validateStorefrontBuild(actual)).files > 0);
  const parent = resolve(project, ".cache", "r2-packaging-tests");
  const root = resolve(parent, randomUUID());
  await mkdir(parent, { recursive: true });
  await mkdir(root);
  await mkdir(resolve(root, "assets"));
  await mkdir(resolve(root, "auth"));
  const template = await readFile(resolve(actual, "index.html"), "utf8");
  const html = template.replace(/\/storefront\/assets\/[^"'?#]+/g, "/storefront/assets/app.js");
  try {
    await writeFile(resolve(root, "index.html"), html);
    await writeFile(resolve(root, "auth", "redirect.html"), '<script type="module" src="/storefront/assets/app.js"></script>');
    await writeFile(resolve(root, "assets", "app.js"), "export const runtimeConfiguration = undefined;");
    assert.equal((await validateStorefrontBuild(root)).files, 3);
    await writeFile(resolve(root, "assets", "app.js.map"), "{}");
    await assert.rejects(validateStorefrontBuild(root), { message: "CONTOSO_UNSAFE_STOREFRONT_BUILD" });
    await rm(resolve(root, "assets", "app.js.map"));
    await writeFile(resolve(root, "assets", "app.js"), `const forbidden = "InstrumentationKey=${randomUUID()}";`);
    await assert.rejects(validateStorefrontBuild(root), { message: "CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG" });
    await writeFile(resolve(root, "assets", "app.js"), "export const runtimeConfiguration = undefined;");
    await writeFile(resolve(root, "index.html"), html.replace("<!--CONTOSO_RUNTIME_CONFIG-->", '<script id="contoso-runtime-config" type="application/json">{}</script>'));
    await assert.rejects(validateStorefrontBuild(root), { message: "CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG" });
    await writeFile(resolve(root, "index.html"), html);
    await rm(resolve(root, "auth", "redirect.html"));
    await assert.rejects(validateStorefrontBuild(root), { message: "CONTOSO_STOREFRONT_BUILD_REQUIRED" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LOCAL production artifact keeps both surfaces and a frozen runtime restore without dev build or fixture entrypoints", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "contoso-package-test-"));
  try {
    const { artifactRoot } = await packageDeployment({ outputRoot: resolve(root, "full") });
    assert.deepEqual((await readdir(artifactRoot)).sort(), ["dist", "package-lock.json", "package.json"]);
    const manifest: unknown = JSON.parse(await readFile(resolve(artifactRoot, "package.json"), "utf8"));
    assert.ok(typeof manifest === "object" && manifest !== null && "scripts" in manifest);
    assert.deepEqual(manifest.scripts, { start: "node dist/bootstrap.js" });
    assert.ok("dependencies" in manifest && typeof manifest.dependencies === "object"
      && manifest.dependencies !== null && "@microsoft/opentelemetry" in manifest.dependencies);
    assert.ok(!("devDependencies" in manifest));
    assert.ok((await validateStorefrontBuild(resolve(artifactRoot, "dist", "storefront"))).files > 0);
    assert.ok((await readFile(resolve(artifactRoot, "dist", "public", "portal-client.js"), "utf8")).length > 0);
    const lock: unknown = JSON.parse(await readFile(resolve(artifactRoot, "package-lock.json"), "utf8"));
    assert.ok(typeof lock === "object" && lock !== null && "lockfileVersion" in lock && lock.lockfileVersion === 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LOCAL SPA-only artifact audits locked runtime and browser builds without replacing existing output", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "contoso-spa-package-test-"));
  try {
    const project = fileURLToPath(new URL("..", import.meta.url));
    const storefront = resolve(project, "..", "storefront-spa");
    const distribution = resolve(project, "dist");
    const buildRoot = resolve(root, "build");
    await cp(distribution, buildRoot, { recursive: true,
      filter: path => path !== resolve(distribution, "storefront") && path !== resolve(distribution, "public") });
    await build({ root: storefront, configFile: resolve(storefront, "vite.config.ts"), logLevel: "silent",
      build: { outDir: resolve(buildRoot, "storefront"), emptyOutDir: false } });
    await build({ root: project, configFile: resolve(project, "vite.portal.config.ts"), logLevel: "silent",
      build: { outDir: resolve(buildRoot, "public"), emptyOutDir: false } });
    const artifactRoot = resolve(root, "spa");
    await packageDeployment({ profile: "spa-only", outputRoot: artifactRoot, buildRoot });
    const manifest = JSON.parse(await readFile(resolve(artifactRoot, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(resolve(artifactRoot, "package-lock.json"), "utf8"));
    assert.deepEqual(manifest.scripts, { start: "node dist/bootstrap-spa-only.js" });
    assert.equal(manifest.dependencies["@microsoft/opentelemetry"], undefined);
    validateSpaRuntimeLock(manifest, lock);
    assert.ok((await validateStorefrontBuild(resolve(artifactRoot, "dist", "storefront"))).files > 0);
    await assert.rejects(packageDeployment({ profile: "spa-only", outputRoot: artifactRoot, buildRoot }), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(await readFile(resolve(artifactRoot, "package.json"), "utf8")), manifest);
    const location = Object.keys(lock.packages).find(key => key.startsWith("node_modules/"));
    assert.ok(location);
    const version = lock.packages[location].version;
    lock.packages[location].version = "1.0.0-beta.1";
    assert.throws(() => validateSpaRuntimeLock(manifest, lock), { message: "CONTOSO_SPA_RUNTIME_LOCK_INVALID" });
    lock.packages[location].version = version;
    delete lock.packages[location].integrity;
    assert.throws(() => validateSpaRuntimeLock(manifest, lock), { message: "CONTOSO_SPA_RUNTIME_LOCK_INVALID" });
    assert.throws(() => validateBrowserDependency({ version: "1.0.0-beta.1" },
      { packages: { "node_modules/example": { version: "1.0.0-beta.1", integrity: "test" } } }, "node_modules/example"),
    { message: "CONTOSO_BROWSER_DEPENDENCY_UNVERIFIED" });
    assert.throws(() => validateBrowserDependency({ version: "1.0.1" },
      { packages: { "node_modules/example": { version: "1.0.0", integrity: "test" } } }, "node_modules/example"),
    { message: "CONTOSO_BROWSER_DEPENDENCY_UNVERIFIED" });
    const index = resolve(buildRoot, "storefront", "index.html");
    await writeFile(index, `${await readFile(index, "utf8")}\n<!-- stale build -->`);
    await assert.rejects(packageDeployment({ profile: "spa-only", outputRoot: resolve(root, "stale"), buildRoot }),
      { message: "CONTOSO_BROWSER_BUILD_DRIFT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LOCAL entire Portal distribution rejects maps, cache, fixture, links and static credentials before artifact replacement", async () => {
  const project = fileURLToPath(new URL("..", import.meta.url));
  const parent = resolve(project, ".cache", "r2-packaging-tests");
  const root = resolve(parent, randomUUID());
  await mkdir(parent, { recursive: true });
  await cp(resolve(project, "dist"), root, { recursive: true });
  try {
    assert.ok((await validatePortalBuild(root)).files > 0);
    await writeFile(resolve(root, "public", "portal-client.js.map"), "{}");
    await assert.rejects(validatePortalBuild(root), { message: "CONTOSO_UNSAFE_PORTAL_BUILD" });
    await rm(resolve(root, "public", "portal-client.js.map"));
    for (const folder of [".cache", "fixtures", "src"]) {
      await mkdir(resolve(root, folder));
      await writeFile(resolve(root, folder, "review-only.txt"), "synthetic negative control");
      await assert.rejects(validatePortalBuild(root), { message: "CONTOSO_UNSAFE_PORTAL_BUILD" });
      await rm(resolve(root, folder), { recursive: true });
    }
    const client = await readFile(resolve(root, "public", "portal-client.js"));
    await writeFile(resolve(root, "public", "portal-client.js"), `const forbidden = "InstrumentationKey=${randomUUID()}";`);
    await assert.rejects(validatePortalBuild(root), { message: "CONTOSO_UNEXPECTED_STATIC_RUNTIME_CONFIG" });
    await writeFile(resolve(root, "public", "portal-client.js"), client);
    await symlink(resolve(root, "public"), resolve(root, "linked-public"), "junction");
    await assert.rejects(validatePortalBuild(root), { message: "CONTOSO_UNSAFE_PORTAL_BUILD" });
    await rm(resolve(root, "linked-public"));
    await rm(resolve(root, "shared", "deadline.js"));
    await assert.rejects(validatePortalBuild(root), { message: "CONTOSO_PORTAL_BUILD_REQUIRED" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
