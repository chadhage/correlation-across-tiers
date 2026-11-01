# Contoso Gateway implementation

This folder and the three APIM modules implement R3's preparation scope. They do not deploy resources, register applications or assign RBAC. R1 owns root network/entrypoints, frozen legal physical names, the shared P1v3 Dedicated compute plan and board. R8 owns identity contracts/JWT validators and assignments. R2's workload-only Portal/SPA cohost and R4's Orders/Inventory are separate modules.

## Module contracts

All APIM resources use **`2024-05-01`**. Internal API/policy/logger names are logical service-local names; physical APIM/App names are root inputs. No separate messaging alias is generated here.

| Module | Inputs | Non-secret outputs |
|---|---|---|
| `infra\modules\apim-service.bicep` | `serviceName`, `location=centralus`, approved `publisherName/publisherEmail`, root `subnetResourceId`, optional `ownedPublicIpResourceId`, `tags` | Service ID/name, gateway URL/host, principal/tenant IDs, management API version, logical resource name |
| `infra\modules\apim-observability.bicep` | `serviceName`, `applicationInsightsResourceId`, secure **versionless reference** `connectionSecretIdentifier`, `samplingPercentage=10`, `diagnosticVerbosity=error`, capture flags/evidence below | Logger/named-value/diagnostic IDs, `diagnosticScope=allApis`, configured percentage, actual configured capture guard result |
| `infra\modules\apim-api-policies.bicep` | `serviceName`, R8 `tenantId/publicAudience/ordersTokenResource`, fixed `ordersBackendBaseUrl` ending `/api`, `allowedCallerClientIds[]`, `portalClientIds[]`, exact `frontendOrigins[]`, `delegatedScope=Orders.Invoke`, response/observation flags, timeout | API/backend/policy/fragment IDs, public/backend paths, proof-header name, required scope/roles and management API version |

The service is **Developer / 1 / External VNet / SystemAssigned** with public APIM ingress. Root supplies the nondelegated APIM subnet, required NSG/DNS/control-plane/telemetry connectivity and optional public IP. Private Apps need an independently verified App/SCM deployment path before public App access is disabled.

Observability uses a **Key Vault-backed named value**, `contoso-appinsights-connection-string`, with omitted KV identity client selection (system identity), and an Application Insights logger whose credentials are:

- `connectionString={{contoso-appinsights-connection-string}}`
- `identityClientId=SystemAssigned`

There is no connection-string-value input/output or instrumentation-key fallback. Root establishes secret read and Monitoring Metrics Publisher independently before module connection.

The all-APIs diagnostic fixes W3C/fixed/allErrors, all four body byte settings **0**, empty frontend request/response headers, empty backend response headers, no client-IP/custom-metric capture, and operation-name format Name. There are no API diagnostic overrides.

`captureCanonicalBackendBusinessHeader=false` by default. It takes effect only with `backendCaptureTimingVerified=true` and a nonzero lower-case 64-hex `backendCaptureEvidenceSha256`. Root/R9 must validate the actual timing evidence and its provenance; a boolean/hash parameter is not itself a live proof. Even then, the sole allowed backend application header is `x-business-invocation-id`.

Known sensitive query-parameter **names** use GA `Hide` masking at all four positions. No wildcard masking support is invented. No query parameter is accepted by the public API. Rejection and exact-name masking do **not** prove that arbitrary frontend URLs were sanitized before capture; native URL/query privacy remains **To Do**.

`samplingPercentage=100` must be applied only by R7's acknowledged bounded lease/restore controller. Source defaults are 10/error with business Trace disabled. The Trace policy is not sampled down by changing diagnostic percentage.

## Authorization and HTTP routing

Public **`/contoso/v1`** maps to private Orders **`/api`**:

| Public operation suffix | Orders suffix |
|---|---|
| `POST /orders` | `POST /orders` |
| `GET /orders/{id}` | `GET /orders/{id}` |
| `GET /me` | `GET /me` |
| `POST /demo-runs` | `POST /demo-runs` |
| `GET /demo-runs/{id}` | `GET /demo-runs/{id}` |
| `POST /demo-runs/{id}/controls` | `POST /demo-runs/{id}/controls` |

Root passes the full Orders HTTPS base **ending `/api`**. Public prefix and backend base are not concatenated twice. R4 health endpoints remain separate from the public business API.

1. A single original caller `Authorization` is validated by the Entra policy for explicit tenant/audience/client IDs.
2. The v2 caller **`publicAudience` is the bare nonzero Orders application GUID**, separately from the registered MI `ordersTokenResource` URI. Delegated caller token scope is **`Orders.Invoke`**, or the approved app-only Portal token has **`idtyp=app`**, no delegated `scp`, **`Portal.Invoke`** and an allowlisted Portal client ID. Frontend OAuth requested scopes are separately resource-qualified; root aligns them with R8/R3. Missing workload type is not silently accepted.
3. APIM removes caller-supplied `X-Contoso-Gateway-Authorization`, obtains its MI token using an output variable, writes that token to the independent proof header, and explicitly restores the **original caller Authorization**.
4. Orders independently validates both tokens and the gateway principal/role **`Gateway.Invoke`** using R8's validators. MI-only Orders does not supply human identity for HMAC.
5. Orders uses its own service credential with **`Inventory.Invoke`** for Inventory. R3 does not copy caller tokens/user headers to Inventory.

The original token is never traced, returned or exported as configuration. Portal app-only callers have **no human pseudonym**. Demo/control authorization and active-window enforcement are independent R8/R4/R2 checks; neither Portal identity, a UUID nor a certification flag substitutes for them.

The OpenAPI file freezes the finite endpoint/request DTOs shared by R2/R4, UUIDv4 shape, scenario and WorkTarget enums, and honest `202 DURABLE_STAGED` semantics. OpenAPI import alone is not runtime body validation; the service DTO validators enforce the payload contract.

## Policies and context

The service policy owns one **direct first inbound CORS** policy. It accepts only exact frontend origins, GET/POST, Authorization/Content-Type/W3C/business headers plus SDK **Request-Context appId metadata**, no cookie credentials, and no client gateway-proof header. Request-Context is not W3C causality or an authorization proof; it is not logged/exposed, and legacy Request-Id is not granted. Optional response exposure is only the canonical edge business header. Unmatched preflight can be empty 200 without a CORS grant. SSR/backend calls do not require browser CORS or Origin.

API composition inherits the service policy, authenticates/authorizes, rejects queries, validates context, removes legacy/spoofable carriers, generates/accepts one business UUID, optionally observes safe business metadata and adds the independent backend proof.

- Parent: case-insensitive header name; exactly one value; lowercase hex/nonzero IDs; exact version-00 length; forbidden `ff`; forward-compatible known prefix for higher versions. Contoso cap is 256 ASCII characters.
- State: ordered combined fields, max 512 ASCII characters/32 members, W3C keys/values/uniqueness including empty OWS members. Invalid state drops **state only** when parent is valid.
- Missing/invalid parent: guarded deletion of parent/state; **the tracer**, not policy, creates a root.
- Valid context is never overridden/appended/copied back. No RequestId-derived IDs, sampled-bit surgery, native-OTLP assumption or active-tracer reset claim.
- APIM diagnostics owns gateway SERVER/backend CLIENT span creation/injection. Orders must parent to the actual backend dependency span, not directly to the browser parent.

Only a validated allowlisted Portal invocation issuer can supply an accepted UUID candidate. All untrusted/malformed/duplicate inputs get one opaque UUIDv4; no rejected raw values are logged. The business ID is not a credential, trace ID or metric dimension.

Business Trace metadata belongs to log telemetry, not automatically to all gateway request/dependency rows. R7/R9 must prove a native attachment/observed binding and distinguish direct/descendant membership from broader trace co-membership, especially with two invocations sharing one trace.

## Local validation

Use the existing Node/Bicep tools; no root package changes are needed:

```powershell
$tests = Get-ChildItem .\tests\apim -Filter *.test.mjs -File | Select-Object -ExpandProperty FullName
node --test $tests
node .\tools\protocol.mjs .
az bicep build --file .\infra\modules\apim-service.bicep --stdout
az bicep build --file .\infra\modules\apim-observability.bicep --stdout
az bicep build --file .\infra\modules\apim-api-policies.bicep --stdout
```

Tests cover context limits/forward compatibility/duplicates/zero IDs/state rejection, business trust, separate caller/proof header observations, CORS negatives, all capture positions, exact source/version-pinned SDK **3.4.5 W3C_TRACE=18**, unsafe defaults/flag writes/RequestId provenance, inactive bad fragments, API schema and test-only fixture exclusion.

`tools\protocol.mjs` reports source/configuration findings without credential values and returns nonzero for violations. Its Node helpers are parsing/checker/transport models, **not R8 JWT validators or APIM C# runtime execution**. The XML reader is additionally checked with native .NET XML parsing; all three Bicep modules are locally compiled.

SDK enum provenance is frozen in `sdk-source-pin.json`: v3.4.5 commit `9f3440d9ac3dd8941f7d004dbae43108b08baf7e`, enum value18 and full source digest. Old mode2 and mixed mode17 are not accepted for this contract. Installed SDK and actual wire behavior require their own observations.

Negative scanner policies under `tests\apim\fixtures` are not deployable inputs. `demo03-cases.v1.json` contains **carrier vectors only**, never fabricated span/telemetry evidence.

## Live unmet acceptance — To Do

- Verify exact named-value resolution/MI ingestion and rotation without secret output; no fallback credentials.
- Capture real approved inbound/outbound `-01` and `-00`, gateway backend dependency ID, active SDK recording/flags and strict parent edges. **Strict `-00` remains To Do**; no header repair or denominator trick.
- Verify gateway extraction/deletion/root timing; a policy deletion is not a supported tracer reset.
- Verify dual caller/gateway token audience/principal/role enforcement, workload omission of human pseudonym and demo/control permissions.
- Prove arbitrary URL/query/header/body/exception privacy with actual source-bound captures/telemetry; exact-name masks and query rejection are not a fake clean result.
- Keep backend Bid capture off until approved actual timing evidence; prove APIM metadata attachment and shared-trace lookup behavior.
- Verify actual SDK/agent/runtime/host/cloud-role/physical-name mapping, complete source/resource/version freeze, private App/SCM reachability and no competing attachment.
- Apply/acknowledge/revert all producer/scope settings only inside an approved lease; inspect actual diagnostic/logger state, allErrors and Trace-policy volume, cost/overhead and reset.

No live card is advanced by a local parser/compile/checker PASS. Root owns final approvals, board and deployment.

## Supported sources

- [GA service](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service), [logger](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/loggers), [diagnostic](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/diagnostics), [named value](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/namedvalues), [policy fragments](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/policyfragments).
- [Application Insights publisher/sampling/overhead](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-app-insights), [MI policy](https://learn.microsoft.com/en-us/azure/api-management/authentication-managed-identity-policy), [Entra validation](https://learn.microsoft.com/en-us/azure/api-management/validate-azure-ad-token-policy), [context whitelist](https://learn.microsoft.com/en-us/azure/api-management/api-management-policy-expressions).
- [CORS](https://learn.microsoft.com/en-us/azure/api-management/cors-policy), [Trace metadata](https://learn.microsoft.com/en-us/azure/api-management/trace-policy), [forwarding](https://learn.microsoft.com/en-us/azure/api-management/forward-request-policy), [private App/SCM](https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint).
- [W3C Recommendation](https://www.w3.org/TR/2021/REC-trace-context-1-20211123/), [exact SDK enum source](https://github.com/microsoft/ApplicationInsights-JS/blob/9f3440d9ac3dd8941f7d004dbae43108b08baf7e/shared/AppInsightsCore/src/enums/ai/Enums.ts).
