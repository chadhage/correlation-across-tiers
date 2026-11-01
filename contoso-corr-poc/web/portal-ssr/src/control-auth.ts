import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ContosoError, isUuid } from "./shared/contracts.js";
import type { ContosoEnvironment } from "./config.js";

export type PortalControlAuthorizer = (bearer: string) => Promise<void>;
export function portalControlAuthorizer(env: ContosoEnvironment, testResolver?: JWTVerifyGetKey): PortalControlAuthorizer {
  const tenant = env.CONTOSO_TENANT_ID;
  const audience = env.CONTOSO_ORDERS_API_CLIENT_ID;
  const clientId = env.CONTOSO_PORTAL_CONTROL_CLIENT_ID;
  const principalId = env.CONTOSO_PORTAL_CONTROL_PRINCIPAL_ID;
  const configured = isUuid(tenant) && isUuid(audience) && isUuid(clientId) && isUuid(principalId);
  const issuer = configured ? `https://login.microsoftonline.com/${tenant}/v2.0` : "";
  const keys = configured ? testResolver ?? createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
    { timeoutDuration: 5000, cooldownDuration: 30000 }
  ) : undefined;
  return async bearer => {
    try {
      if (!configured || !keys || !bearer || bearer.length > 32000 || /[\r\n]/.test(bearer))
        throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
      const { payload } = await jwtVerify(bearer, keys, {
        issuer, audience, algorithms: ["RS256"], clockTolerance: 30,
        requiredClaims: ["exp", "nbf", "iss", "aud", "tid", "ver", "idtyp", "azp", "oid", "roles"]
      });
      const roles: readonly unknown[] = Array.isArray(payload.roles) ? payload.roles : [];
      if (payload.tid !== tenant || payload.ver !== "2.0" || payload.idtyp !== "app"
        || payload.azp !== clientId || payload.oid !== principalId || payload.scp !== undefined
        || !roles.includes("Portal.Invoke"))
        throw new ContosoError("PORTAL_CONTROL_REJECTED", 403);
    } catch { throw new ContosoError("PORTAL_CONTROL_REJECTED", 403); }
  };
}
