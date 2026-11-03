import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { portalControlAuthorizer } from "../dist/control-auth.js";
import { ContosoError } from "../dist/shared/contracts.js";

test("FIXTURE fixed workload controller JWT is checked independently of window flags", async () => {
  const tenant = randomUUID();
  const audience = randomUUID();
  const client = randomUUID();
  const principal = randomUUID();
  const env = { CONTOSO_TENANT_ID: tenant, CONTOSO_ORDERS_API_CLIENT_ID: audience,
    CONTOSO_PORTAL_CONTROL_CLIENT_ID: client, CONTOSO_PORTAL_CONTROL_PRINCIPAL_ID: principal };
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const resolver = createLocalJWKSet({ keys: [{ ...jwk, kid: "contoso-fixture", alg: "RS256", use: "sig" }] });
  const verify = portalControlAuthorizer(env, resolver);
  async function token(overrides: Readonly<Record<string, unknown>> = {}): Promise<string> {
    return new SignJWT({ tid: tenant, ver: "2.0", idtyp: "app", azp: client, oid: principal, roles: ["Portal.Invoke"], ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "contoso-fixture" }).setIssuedAt().setNotBefore("0s")
      .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`).setAudience(audience).setExpirationTime("2m").sign(privateKey);
  }
  await verify(await token());
  await assert.rejects(verify(await token({ idtyp: "user", scp: "Orders.Invoke" })), ContosoError);
  await assert.rejects(verify(await token({ oid: randomUUID() })), ContosoError);
  await assert.rejects(verify(await token({ azp: randomUUID() })), ContosoError);
  await assert.rejects(verify(await token({ roles: ["Inventory.Invoke"] })), ContosoError);
  await assert.rejects(portalControlAuthorizer({})(await token()), ContosoError);
});
