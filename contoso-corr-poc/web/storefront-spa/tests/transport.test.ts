import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedApiUrl } from "../../portal-ssr/dist/shared/browser-api.js";
import { fixtureConfig } from "../../portal-ssr/tests/fixture-config.ts";

test("FIXTURE Storefront routes use the single approved public API prefix", () => {
  const config = fixtureConfig();
  assert.equal(guardedApiUrl(config, "/orders").pathname, "/contoso/v1/orders");
  assert.equal(guardedApiUrl(config, `/demo-runs/${randomUUID()}`).origin, config.api.origin);
  assert.throws(() => guardedApiUrl(config, "/api/orders"));
  assert.throws(() => guardedApiUrl(config, "/orders#not-allowed"));
});
