import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStorefrontBuild } from "../scripts/package-cohost.mjs";
import { packageDeployment, validatePortalBuild } from "../scripts/package-deployment.mjs";

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
  const { artifactRoot } = await packageDeployment();
  assert.deepEqual((await readdir(artifactRoot)).sort(), ["dist", "package-lock.json", "package.json"]);
  const manifest: unknown = JSON.parse(await readFile(resolve(artifactRoot, "package.json"), "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null && "scripts" in manifest);
  assert.deepEqual(manifest.scripts, { start: "node dist/bootstrap.js" });
  assert.ok(!("devDependencies" in manifest));
  assert.ok((await validateStorefrontBuild(resolve(artifactRoot, "dist", "storefront"))).files > 0);
  assert.ok((await readFile(resolve(artifactRoot, "dist", "public", "portal-client.js"), "utf8")).length > 0);
  const lock: unknown = JSON.parse(await readFile(resolve(artifactRoot, "package-lock.json"), "utf8"));
  assert.ok(typeof lock === "object" && lock !== null && "lockfileVersion" in lock && lock.lockfileVersion === 3);
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
