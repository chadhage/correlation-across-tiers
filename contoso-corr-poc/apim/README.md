# Contoso Gateway implementation

This folder and the three APIM modules implement R3's preparation scope. They do not deploy resources, register applications or assign RBAC. R1 owns root network/entrypoints and frozen legal physical names; R4 owns compute, R9 owns the board, and R8 owns identity contracts/JWT validators and assignments. R2's workload-only Portal/SPA cohost and R4's Orders/Inventory are separate modules.

## Module contracts

All APIM resources use **`2024-05-01`**. Internal API/policy/logger names are logical service-local names; physical APIM/App names are root inputs. No separate messaging alias is generated here.

| Module | Inputs | Non-secret outputs |
|---|---|---|
| `infra\modules\apim-service.bicep` | `serviceName`, `location=centralus`, approved `publisherName/publisherEmail`, root `subnetResourceId`, optional `ownedPublicIpResourceId`, `tags` | Service ID/name, gateway URL/host, principal/tenant IDs, management API version, logical resource name |
| `infra\modules\apim-observability.bicep` | `serviceName`, `applicationInsightsResourceId`, secure **versionless reference** `connectionSecretIdentifier`, `samplingPercentage=10`, `diagnosticVerbosity=error`, capture flags/evidence below | Logger/named-value/diagnostic IDs, `diagnosticScope=allApis`, configured percentage/verbosity, reference kind, external lease requirement, actual configured capture guard result |
| `infra\modules\apim-api-policies.bicep` | `serviceName`, R8 `tenantId/publicAudience/ordersTokenResource`, fixed `ordersBackendBaseUrl` ending `/api`, `allowedCallerClientIds[]`, `portalClientIds[]`, exact `frontendOrigins[]`, `delegatedScope=Orders.Invoke`, response/observation flags, timeout | API/backend/policy/fragment IDs, public/backend paths, separate caller/proof-header names, required scope/roles and management API version |

Configuration named values deploy before policy fragments; the composed API policy waits for named values, fragments, the inherited service policy and the fixed TLS backend. GUID-only tenant/audience/caller/Portal IDs are normalized to lower case before materialization and authenticated client GUID lookup; resource URIs, scopes, roles and the original JWT are not rewritten. Root can preflight inputs with `validateModuleParameters` and the App Insights-only `validateSecretReference` in `tools\protocol.mjs`. The latter rejects inline values, versioned App Insights URIs, nonstandard ports, invalid vault names and URL normalization tricks. R8's explicitly versioned HMAC URI is a different contract.

The service is **Developer / 1 / External VNet / SystemAssigned** with public APIM ingress. Root supplies the nondelegated APIM subnet, required NSG/DNS/control-plane/telemetry connectivity and optional public IP. Private Apps need an independently verified App/SCM deployment path before public App access is disabled.

Observability uses a **Key Vault-backed named value**, `contoso-appinsights-connection-string`, with omitted KV identity client selection (system identity), and an Application Insights logger whose credentials are:

- `connectionString={{contoso-appinsights-connection-string}}`
- `identityClientId=SystemAssigned`

There is no connection-string-value input/output or instrumentation-key fallback. Root establishes secret read and Monitoring Metrics Publisher independently before module connection.

The all-APIs diagnostic fixes W3C/fixed/allErrors, all four body byte settings **0**, empty frontend request/response headers, empty backend response headers, no client-IP/custom-metric capture, and operation-name format Name. There are no API diagnostic overrides.

`captureCanonicalBackendBusinessHeader=false` by default. It takes effect only with `backendCaptureTimingVerified=true` and a nonzero lower-case 64-hex `backendCaptureEvidenceSha256`. Root/R9 must validate the actual timing evidence and its provenance; a boolean/hash parameter is not itself a live proof. Even then, the sole allowed backend application header is `x-business-invocation-id`.

Known sensitive query-parameter **names** use GA `Hide` masking at all four positions. No wildcard masking support is invented. No query parameter is accepted by the public API. Rejection and exact-name masking do **not** prove that arbitrary frontend URLs were sanitized before capture; native URL/query privacy remains **To Do**.

`samplingPercentage=100` must be applied only by R7's acknowledged bounded lease/restore controller. Bicep cannot autonomously expire a diagnostic; `fullSamplingRequiresExternalLeaseController` is a requirement indicator, not proof of a running watchdog. Source defaults are 10/error with business Trace disabled. The Trace policy is not sampled down by changing diagnostic percentage. Enabling its information-level metadata also needs diagnostic verbosity and the named observation switch, an independent volume budget and restoration; percentage-only control does not prove metadata collection.

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

`GET /me` returns `actorType=user|workload`, not invented upper-case names. Optional user-only pseudonyms match `h1:<32 lower-case hex secret-version>:<43 base64url characters>`; a workload actor cannot carry one. For creation POSTs, the edge response invocation header equals the response body's `businessInvocationId`, not its order/run ID. Workflow GET bodies retain the original durable invocation, which may differ from the new GET's ingress response header.

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

## Preparation-only native sampling hooks

`createApimSamplingAdapter` in `tools\protocol.mjs` implements the pinned GA ARM diagnostic GET/PATCH protocol. It requires an injected, independently authorized `request({method,url,headers,body,redirect})` transport returning `{status,headers,body}`. The transport must enforce `redirect=error` and keep its credentials private. No transport, token acquisition or cloud operation is supplied by default.

| Hook | Input / result |
|---|---|
| `prepare({lease})` | Checks the all-APIs diagnostic and paginated API diagnostics for overrides; returns a persistable safe production snapshot, owned-field hash and GET ETag. |
| `apply({lease,snapshot,ownedPatch})` | Requires explicit `allowAzureWrites=true` plus a separate approval reference, active pre-drain lease, unchanged baseline and real conditional ETag; PATCH includes required logger ID and preserves query masking. |
| `observe({lease,ownedPatch})` | Independent GET readback, owned-field hash, percentage and match result. |
| `restore({lease,snapshot,appliedOwnedPatch})` | Conditional, idempotent production restoration; refuses foreign owned-field changes. A late restore is still attempted but reports the missed deadline. |

Lease fields are R7's `runId`, `startsAtUtc`, `expiresAtUtc`, `drainAtUtc`, `restoreDeadlineUtc`: UUIDv4, UTC, maximum two-hour window and maximum 120-second restore reserve. Prepared snapshots bind all five fields in `leaseBinding`; changing the expiry/window under the same ID cannot revive a stale snapshot. The twelve exported `APIM_SAMPLING_OWNED_FIELDS` match R7's current percentage/W3C/allErrors/body/header patch. They cannot add RPS, body/header capture, arbitrary sinks or sampled-flag mutation. Source scanner checks also reject disguised context deletions, composed mixed SDK modes, undeclared policy egress and unresolved body capture.

Results are **`sourceKind=management-plane-observation`**, **`runtimeAcknowledgement=false`**, with effective sampling and wire parentage **To Do**. They are not `contoso.sampling-control-ack.v1` and must not be relabelled as trusted runtime observations. R7 owns prepare/quiesce/apply/observe/drain/restore orchestration, independent watchdog, traffic control and native request/export proof. A stored snapshot, GET result, approval string or unit-test transport is not a live attestation. No approved cloud writes were performed to validate these hooks.

## Local validation

Use the existing Node/Bicep tools; no root package changes are needed:

```powershell
$tests = Get-ChildItem .\tests\apim -Filter *.test.mjs -File | Select-Object -ExpandProperty FullName
$env:CONTOSO_BICEP_PATH = '<path-to-existing-frozen-bicep.exe>'
node --test --test-reporter=spec $tests
node .\tools\protocol.mjs .
```

The compiler test checks the executable's version/hash against the existing version lock, compiles all three modules and inspects emitted dependencies, credential references, scope, body/header settings and paths. With no compiler configured or on PATH it explicitly skips compilation; that run supplies no compiler evidence. It never downloads a substitute.

Tests cover context limits/forward compatibility/duplicates/zero IDs/state rejection, business trust, case-variant/folded dual-token headers, CORS negatives, all capture positions, exact source/version-pinned SDK **3.4.5 W3C_TRACE=18**, unsafe defaults/flag writes/RequestId provenance, inactive bad fragments, API schema, native-management CAS/restore and test-only fixture exclusion.

`Invoke-PolicyExpressions.ps1` loads the actual fragment XML with DTD/resolver disabled, extracts and compiles its C# expressions, and executes context/business/auth-shape cases against local context/Jwt carrier bindings. This is real local CLR expression execution, **not APIM hosting, native extraction/root reset, JWT signature validation or wire evidence**. `tools\protocol.mjs` reports source/configuration findings without credential values and returns nonzero for violations.

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

No live card is advanced by a local parser/compile/checker PASS. Root owns approval/deployment integration; R9 alone owns board state and completion adjudication.

## Supported sources

- [GA service](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service), [logger](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/loggers), [diagnostic](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/diagnostics), [named value](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/namedvalues), [policy fragments](https://learn.microsoft.com/en-us/azure/templates/microsoft.apimanagement/2024-05-01/service/policyfragments).
- [Application Insights publisher/sampling/overhead](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-app-insights), [MI policy](https://learn.microsoft.com/en-us/azure/api-management/authentication-managed-identity-policy), [Entra validation](https://learn.microsoft.com/en-us/azure/api-management/validate-azure-ad-token-policy), [context whitelist](https://learn.microsoft.com/en-us/azure/api-management/api-management-policy-expressions).
- [Pinned diagnostic GET/ETag](https://learn.microsoft.com/en-us/rest/api/apimanagement/diagnostic/get?view=rest-apimanagement-2024-05-01), [PATCH/If-Match/logger ID](https://learn.microsoft.com/en-us/rest/api/apimanagement/diagnostic/update?view=rest-apimanagement-2024-05-01).
- [CORS](https://learn.microsoft.com/en-us/azure/api-management/cors-policy), [Trace metadata](https://learn.microsoft.com/en-us/azure/api-management/trace-policy), [forwarding](https://learn.microsoft.com/en-us/azure/api-management/forward-request-policy), [private App/SCM](https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint).
- [W3C Recommendation](https://www.w3.org/TR/2021/REC-trace-context-1-20211123/), [exact SDK enum source](https://github.com/microsoft/ApplicationInsights-JS/blob/9f3440d9ac3dd8941f7d004dbae43108b08baf7e/shared/AppInsightsCore/src/enums/ai/Enums.ts).
