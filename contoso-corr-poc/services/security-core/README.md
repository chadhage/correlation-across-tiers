# Contoso verified identity boundary

**Preparation-only; NOT CERTIFIED.** This is the real reactor module, not a
construction stub. Its public consumer API is:

```java
RequestAuthenticator.fromEnvironment(canonicalServiceName);
authenticator.authenticate(authorization, gatewayAuthorization);
// VerifiedCaller: actorType(), pseudonym(), roles(),
// trustedInvocationIssuer(), canControlRuns(); authenticator.close().
```

## Authentication and trust

Orders receives the original independently validated caller token in
`Authorization` and the APIM managed-identity JWT in
`X-Contoso-Gateway-Authorization`. The latter is validated **first**.
APIM must strip inbound proof headers and inject its own proof after validating
and authorizing the original caller. No test header, caller flag, trace header,
business ID, or claimed role alone creates trust.

Nimbus JOSE/JWT performs RS256 signature verification with public RSA keys,
2048–4096 bits. JSON duplicates, unsigned/HMAC tokens, remote-key headers,
unknown critical headers, wrong issuer/tenant/audience/client/principal, missing
timestamps, future tokens and expired tokens fail closed. Only configured
single-tenant Microsoft public-cloud v1/v2 issuers and tenant-specific key
endpoints are used by `fromEnvironment`; callers cannot select a key endpoint.
The POC allows 30 seconds of clock skew and a two-hour maximum token lifetime.
Long-lived CAE tokens and other clouds require a separately reviewed policy.

Gateway and workload authorization requires signed `idtyp=app`, **absent**
`scp`, the required application role, and an exact allowlisted client-ID **and**
service-principal object-ID pair. Delegated Storefront calls require its
allowlisted client ID and `Orders.Invoke`. Inventory permits only the Orders
workload with `Inventory.Invoke`. Portal requires `Portal.Invoke`, is
workload-only, and never represents an end user. Run control additionally
requires `Demo.Control`; workload controllers require a separate identity
allowlist. The frozen API response uses `actorType: user|workload`; only users
have a pseudonym.

The gateway's authenticated, ingress-restricted boundary owns public business-ID
generation. Verified workload invocation issuers may preserve an opaque ID.
Business identity remains correlation, never authorization or a metric label.

**Bearer replay limitation:** Entra access tokens are intentionally reusable.
Reusing a still-valid token is not cryptographic request-body binding or
anti-replay. Tests reject replayed expired/foreign proofs, not normal token-cache
reuse. Theft of a valid authorized token remains a risk; TLS, main-site ingress
restrictions, expiry and separately protected durable idempotency state are
required. Neither telemetry actor names nor browser ingestion prove provenance.

## Configuration

All values below are identity metadata or secret **references**, not secrets:

| Setting | Meaning |
|---|---|
| `CONTOSO_TENANT_ID` | Approved single tenant |
| `CONTOSO_PUBLIC_AUDIENCE` | Exact original Orders token audience |
| `CONTOSO_ORDERS_AUDIENCE` | Exact gateway JWT audience |
| `CONTOSO_INVENTORY_AUDIENCE` | Exact Inventory JWT audience |
| `CONTOSO_STOREFRONT_CLIENT_ID` | Allowed delegated client |
| `CONTOSO_GATEWAY_CLIENT_ID`, `CONTOSO_GATEWAY_OBJECT_ID` | APIM workload identity pair |
| `CONTOSO_PORTAL_CLIENT_ID`, `CONTOSO_PORTAL_OBJECT_ID` | Portal workload identity pair |
| `CONTOSO_ORDERS_CLIENT_ID`, `CONTOSO_ORDERS_OBJECT_ID` | Orders workload identity pair |
| `CONTOSO_HMAC_SECRET_URI` | Exact versioned Key Vault secret URI |

The delegated scope defaults to `Orders.Invoke` and cannot be weakened.
Optional `CONTOSO_RUN_CONTROLLER_CLIENT_ID/OBJECT_ID` must match the permitted
Portal identity and still needs `Demo.Control`. Optional
`CONTOSO_MANAGED_IDENTITY_CLIENT_ID` selects an explicitly assigned user identity;
otherwise the SDK uses system-assigned managed identity, never an operator's
default CLI credentials.

V2 JWT audiences are application client GUIDs, not automatically the token
request's `api://` resource URI. Explicit comma-separated audience aliases can
support a reviewed v1/v2 migration. Outbound clients must keep their token
resource (`CONTOSO_INVENTORY_TOKEN_RESOURCE`) separate from expected JWT audiences.

## Key refresh, entropy and identity privacy

JWKS is read with bounded response size and five-second total request timeout,
no redirects, an hourly refresh and five-minute unknown-key fetch throttling.
Last-known keys survive a temporary outage for at most 24 hours; successfully
refreshed metadata removes retired keys. This is not immediate revocation during
an outage. Daemon refreshers close with the authenticator; the dedicated,
long-lived SDK HTTP client is shared for the process.

HMAC-SHA256 uses canonical tenant/object IDs **inside** the security boundary
with a workload-specific domain separator. The output is
`h1:<32-hex-secret-version>:<43-character-unpadded-base64url-digest>`.
No raw JWT, claims bundle, email, UPN or user object ID is returned or logged.
`VerifiedCaller` and key holders have redacted `toString`; errors carry fixed
codes without raw SDK causes. `SafeAuthenticationTelemetry` supplies only finite
outcome/actor/role categories for the existing request span, not another provider.

The Key Vault SDK reads an exact secret version with HTTP logging off and a
bounded call. Enabled/not-before/expiry are enforced; a five-minute cache is
revalidated against the same version. Failed reads are throttled for 30 seconds;
expiry is checked again after acquisition, never against an old clock snapshot.
`rotate(nextReference)` explicitly changes
the version of the **same** vault/secret, installs the new material and clears the
old byte array. There is no unkeyed-hash or unavailable-vault fallback.

`HmacSecretBootstrap.prepareInMemory()` generates 256 bits with `SecureRandom`.
Its separate `storeAfterExplicitApproval` API is reference code only: no startup,
CLI, test or deployment calls cloud SET. **A separate human approval is required**
before invoking it. SDK strings are immutable and cannot promise complete memory
erasure; controlled byte buffers are cleared, and no values are written to files,
arguments, logs, transcripts or evidence. Generation is client-side, not
Key Vault-generated entropy. Exact cryptoperiod, retention/purge and reader
approval remain privacy-owner prerequisites.

`BoundedTokenProvider` provides expiring single-flight in-memory token caching,
60-second renewal margin, caller-budget lock/acquisition bounds (maximum
30 seconds), redacted failures and explicit close.

`SecurityLoggingGuard` fails startup and Key Vault reads unless Azure Identity,
Key Vault, Azure Core and MSAL logger packages **and existing child overrides**
are effectively OFF. HTTP-log level NONE alone does not prevent SDK error logs.
The fixed safe `com.contoso` authentication outcomes remain observable through
the existing provider. Implicit JDK HTTP wire logging is also rejected.

## IaC and validation

`infra\modules\security-keyvault.bicep` prepares Standard Key Vault with RBAC,
purge protection, deny-by-default firewall and secret-reference outputs.
`security-secret-readers.bicep` references existing named secrets and prepares
read-only Secrets User assignments at **named-secret**, not vault-wide, scope.
Neither module contains secret values or creates secret versions. Allowed
subnets require `Microsoft.KeyVault` service endpoints; APIM's managed-identity
trusted-service path and actual ingress/reachability still need deployment
validation. No resource, role assignment, consent or cloud secret was created.

`identity\entra-preparation.v1.json` is an approval checklist/manifest contract,
not an executed registration or grant. The APIs must request v2 access tokens,
expose application-only invocation roles and include the `idtyp` optional claim.

From the repository root, after sourcing the existing pinned portable toolchain:

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
mvn -q -f .\contoso-corr-poc\services\security-core\pom.xml test
.\contoso-corr-poc\tools\security\Run-SecurityGates.ps1
```

Tests generate RSA/HMAC material in memory, use a real bounded loopback JWKS
server, and verify forgery, expiry, audience/issuer/tenant, key rollover,
unknown-key flooding, role/app-only separation, replay boundaries, HMAC rotation
and token deadlines. They do not certify Azure Entra issuance, deployed ingress,
secret resolution, exported telemetry, or governance acceptance.

The separate [AV23 native wire qualification](docs/AV23.md) records historical
Java propagation failures and the later production OkHttp header-isolation
observations. The ineffective disable flag was removed under the user's
`header_isolation_only` decision; current-source native qualification remains
pending. The actual Portal Node provider passed its scoped JWKS/MI/metadata
wire controls. Neither result certifies Azure.

## Approved OkHttp isolation candidate

`approve_okhttp` authorized a credential-only official Azure OkHttp transport.
`IdentityHttpClients` now exposes `httpClient()`, `managedIdentity()` /
`managedIdentity(optionalClientId)`, `defaultCredential()` and
`keyVaultSecrets(vaultUri, credential)`. The managed and DefaultAzure/operator
choices remain distinct; generic/injected credentials are not silently replaced.

The official SDK plugin is `azure-core-http-okhttp:1.13.8`; effective package
resolution selected OkHttp `4.12.0`, Okio JVM `3.18.1`, Azure Netty `1.16.8` /
Reactor Netty HTTP `1.3.8` transitively, and Kotlin stdlib `2.3.21`.
The actual dependency tree is written by the granted package phase under
`target\okhttp-effective-dependencies.txt`.

The public REST wrapper removes only context/business headers at each
subscription. The public network interceptor preserves method/body and auth
headers and rejects redirects; standard TLS/hostname validation is unchanged.
The user selected `header_isolation_only` after the actual Microsoft 3.7.10
agent ignored the upstream OkHttp-disable option. The ineffective flag and
factory admission dependency are removed. Identity CLIENT spans remain within
the application; supported public REST/network header controls enforce the
unchanged no-context-headers requirement on every production identity attempt.
The raw unfiltered OkHttp probe is an explicit negative control: native
interceptor/context presence is expected and recorded, not silently greened.
Production SDK JWKS/MI/retry headers must all be absent, with actual used-client
origins and trusted JDK parent advancement independently verified.

Business SDK HTTP clients must explicitly retain Netty because adding an SDK
HTTP provider must not let implicit ServiceLoader selection change business
transport. No business JDK/framework instrumentation is disabled.
Observed client CodeSource/class-resource hashes are finite provenance facts,
not global provider counts or source-build lineage certification. The SDK client
send counter must be bound to real wire receipts; the configured OkHttp
prototype passed to the SDK builder is still creation-only evidence.

The current parent source/build A passed 32 tests and produced `e58d5143...`;
its no-switch native B passed the finite header/used-client scope. Both original
reviewers accepted that scoped source/receipt consistency, not a new native
rerun or full certification. A later finite native B measured one JWKS and two
MI CLIENT outputs with the real root trace/parent. Its original source/receipt
consistency reviews do not establish global exporter or Azure certification.
R2 subsequently found an adversarial scalar regex-stall gap; the corrected
test-only receiver adds pre-pattern UTF-8 scalar/key bounds without truncation.
That source/import delta requires separately granted current native validation
and reviews. It remains **NOT API_READY**.
Production bytes are not rebuilt for that test-only extension. Earlier
Netty/c3/BB and parent raw-control overall failures remain immutable.

### Sources

- [Microsoft claims validation](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)
- [Access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)
- [Signing-key rollover](https://learn.microsoft.com/en-us/entra/identity-platform/signing-key-rollover)
- [Official Spring Security 7.1.2 compatible Nimbus 10.9.1 pin](https://repo.maven.apache.org/maven2/org/springframework/security/spring-security-oauth2-jose/7.1.2/spring-security-oauth2-jose-7.1.2.pom)
- [Azure SDK BOM 1.3.9: Identity/Key Vault versions](https://repo.maven.apache.org/maven2/com/azure/azure-sdk-bom/1.3.9/azure-sdk-bom-1.3.9.pom)
- [Key Vault RBAC and named-secret scopes](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)
- [App Service Key Vault references](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references)
- [Key Vault 2025-05-01 resource schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.keyvault/2025-05-01/vaults)
