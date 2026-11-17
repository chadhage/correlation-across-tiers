# Demo 01: from stock Application Insights to the synchronous golden path

This is the adoption checklist for an existing browser -> API gateway ->
Orders -> Inventory -> PostgreSQL/Redis application whose ARM template already
creates Application Insights and connects its application hosts. It explains
the **delta**, not a second deployment template. Stock integration varies:
inventory what is actually enabled before changing it.

**Status:** implementation guidance and runnable local sample, not proof of
Azure completion. Follow the [getting-started guide](GETTING_STARTED.md) for
commands, approvals and current blockers, and the [completion backlog](COMPLETION.md)
for remaining acceptance work. Do not deploy the sample root over an existing
production resource group.

## 1. Run the sample before porting it

1. Follow [prerequisites and checkout](GETTING_STARTED.md#2-prerequisites-and-first-checkout).
   Start from the POC root, not an individual service directory. Resolve the
   documented shared-checkout build caveat before relying on a new run.
2. Follow the [sample source walkthrough](GETTING_STARTED.md#sample-code-walkthrough)
   and then run the [one-command rehearsal](GETTING_STARTED.md#3-one-command-local-scenario).
   This needs no Azure account, connection string or production credential.
3. Inspect the saved browser receipt and trace tree. Expect six local boundary
   types and an explicit failure for the two absent APIM boundary types.
   Never insert artificial Gateway telemetry to close that gap.
4. Follow [local debugging](GETTING_STARTED.md#4-local-development-and-debugging)
   to step through the real handlers. Keep synthetic authentication and ingress
   observation in test sources; neither belongs in a production package.
5. Only then port the changes below to your boilerplate on a separate branch.
   Record a baseline request and deployment configuration privately so that
   instrumentation and infrastructure changes can be rolled back.

## 2. Inventory the out-of-box integration

Record the actual resource/workspace, runtime, telemetry library/agent version,
startup command, role names, sampling settings, SDK initializers/processors,
exporters, APIM diagnostic scope and browser loader. Inspect the template,
deployed settings and process launch configuration; template intent alone is
not runtime proof. Do not dump resolved app settings or credentials to logs.

| Typical stock behavior | Keep | Change or verify for this scenario |
|---|---|---|
| ARM creates `Microsoft.Insights/components` and a connection-string app setting | Existing approved resource, retention and alerting where suitable | Use a workspace-based component; this sample uses one shared component/workspace and distinct roles. Reconcile resource IDs, ingestion permissions and network routes. |
| App Service injects an agent or the application starts an SDK | One supported instrumentation owner | Remove conflicting automatic/manual owners before activating the sample's explicit Java agent. Never stack two Java agents, two browser loaders or independent server providers/exporters. |
| Server HTTP requests/dependencies are auto-collected | Framework/server and HTTP-client instrumentation | Verify W3C continuation, active context across executors and direct parent edges. Do not wrap an already auto-collected HTTP boundary in another equivalent span. |
| Backend connection string is configured | Approved server configuration/reference | Configure the browser SDK separately. A server setting does not instrument browser Fetch/XHR. |
| APIM forwards requests | Existing reviewed routes and authorization | Add/verify an Application Insights logger and W3C request/backend diagnostics; a gateway resource alone supplies neither boundary proof. |
| SQL/Redis libraries auto-collect command telemetry | Database/cache behavior | For this sample's privacy contract, replace command-level collection with its safe logical CLIENT operations, suppressing the corresponding automatic collectors. |
| Adaptive/fixed/rate-limited sampling and ingestion caps are enabled | Approved operational cost controls | Arrange a finite observed acceptance window across all participants; a component property set to 100 is not end-to-end unsampled collection. Restore baseline afterward. |

These are requirements to match **this scenario**, not a claim that every
Application Insights application must replace its telemetry stack. For .NET,
Python or another runtime, keep its supported single SDK/provider and implement
the same wire/context/privacy contract with that runtime's APIs; the Java
launcher and sampler JAR are not portable to those runtimes.

## 3. Modify ARM configuration without replacing the application

Use your existing template/module structure and parameterize actual approved
target names. Compare it to these sample modules:

1. **Telemetry resources:** [telemetry.bicep](../../infra/modules/telemetry.bicep)
   binds `Microsoft.Insights/components.properties.WorkspaceResourceId` to the
   workspace. Review retention, ingestion/query networking, cap and action-group
   routes. Keep connection values out of ARM outputs and packages.
   The sample's browser path requires public ingestion and permits browser
   connection-string ingestion; do not copy an Entra-only ingestion setting
   that breaks that path, or weaken an existing policy without approval.
2. **Hosts and instrumentation ownership:**
   [compute.bicep](../../infra/modules/compute.bicep) sets
   `APPLICATIONINSIGHTS_CONNECTION_STRING` to a Key Vault reference,
   `APPLICATIONINSIGHTS_CONFIGURATION_FILE` to the packaged agent JSON, and
   distinct `APPLICATIONINSIGHTS_ROLE_NAME` / `OTEL_SERVICE_NAME` values.
   Orders and Inventory use `contoso-orders-api` and `contoso-inventory-api`.
   Keep those names if using the unchanged root boundary contract; changing
   names also requires an explicit reviewed contract/query mapping update.
3. **Launch configuration:** the host's `appCommandLine` invokes the packaged
   [startup.sh](../../tools/java/startup.sh). It installs exactly the locked
   agent and parent-safe extension through `JAVA_TOOL_OPTIONS`; it does not
   rely on the platform extension to inject a second agent.
   Copy the coordinated startup/settings/package changes, not just
   `ApplicationInsightsAgent_EXTENSION_VERSION='disabled'`: disabling the old
   owner before supplying a working replacement creates a telemetry outage.
   Review inherited JVM options as well as template settings.
4. **Gateway:** port the logger and **service-level/all-APIs**
   `Microsoft.ApiManagement/service/diagnostics` configuration from
   [apim-observability.bicep](../../infra/modules/apim-observability.bicep).
   It uses `httpCorrelationProtocol='W3C'`, a Key Vault-backed named value and
   managed-identity publishing. Ensure secret-read and telemetry-publish
   permissions are effective. Check for API-level overrides.
   The operator accepts this same service-level scope and rejects API-scoped
   overrides; the contract has local regression coverage, not live proof.
5. **Application and identity settings:** bind actual API origins/audiences,
   client/object-ID allowlists, redirect URIs, data endpoints, managed identities
   and narrow data/secret permissions using the existing
   [Azure stages](GETTING_STARTED.md#6-azure-approvals-and-deployment-stages).
   Do not copy fixture IDs or expose backend secret references in browser JSON.

The sample root is target-bound and provisions the **whole POC**. Its guarded
deployment/publisher scripts are reusable for that approved target, not generic
deploy-to-any-subscription tools. Adopting the design into your own ARM template
requires your own target review, what-if, approvals and rollback plan; do not
remove the sample's safety checks to force it onto a different target.

## 4. Instrument the browser once, before the first API call

Reuse [browser-telemetry.ts](../../web/portal-ssr/src/shared/browser-telemetry.ts),
its typed [contracts](../../web/portal-ssr/src/shared/contracts.ts) and
[browser-api.ts](../../web/portal-ssr/src/shared/browser-api.ts), rather than
pasting only an SDK initialization line. The Storefront
[app.ts](../../web/storefront-spa/src/app.ts) shows their composition.

Required changes from a basic loader:

1. Initialize once before Fetch/XHR. The sample uses the locked JS SDK,
   `DistributedTracingModes.W3C_TRACE`, automatic Fetch/XHR dependencies and
   `enableCorsCorrelation: true`.
2. Populate `approvedCorrelationOrigins` with exact approved API origins and
   `excludedCorrelationHosts` with excluded hosts. Retain the dependency-listener
   veto: a host list alone is not an exact scheme/port/origin policy.
   Do not propagate business context to identity, ingestion or arbitrary
   third-party endpoints.
3. Set the Storefront role to `contoso-storefront-spa`. Retain the safe telemetry
   initializer, URL redaction, disabled request/response-header capture and
   identity exclusions. A browser connection string is observable by users;
   never put tokens, HMAC keys or private server settings in it.
4. Configure APIM CORS for the actual frontend origins, GET/POST and required
   headers (`Authorization`, `Content-Type`, `traceparent`, `tracestate`,
   `Request-Context`, `x-business-invocation-id`). Expose
   `x-business-invocation-id` so the SDK/client can read the canonical response.
   See [service-policy.xml](../../apim/policies/service-policy.xml); its
   placeholders must be rendered, not deployed verbatim.
5. Use the existing authenticated, bounded client. Do not set `traceparent`
   yourself: the SDK's HTTP dependency must own the outgoing carrier.

For example, the ordinary-order payload is:

```json
{
  "schemaVersion": 1,
  "sku": "CONTOSO-001",
  "quantity": 1
}
```

In the existing Storefront composition, `api.order(body)` sends that payload
to `POST /contoso/v1/orders`, validates the canonical response and returns the
staged workflow. `api.workflow("orders", staged.id)` performs read-back.
Use an owned seeded SKU in an approved fixture; a POST changes durable state.
The [CLI client](order-client.mjs) is an API-only alternative with explicit
traffic approval, **not** a substitute for browser tracing or run-owned cleanup.

## 5. Preserve W3C context through APIM and both APIs

1. Port the ordered fragments in
   [api-policy.xml](../../apim/policies/api-policy.xml), including authentication,
   request guard, context validation, header hygiene, business ID, backend proof
   and response ID. Preserve required `<base />` inheritance.
   Do not deploy fragment references without their rendered fragments/named values.
2. Let APIM's tracer create its actual request and backend dependency and advance
   the outgoing parent. Do not overwrite the backend carrier with the original
   browser header or manufacture IDs from APIM's request ID.
3. Let the server agent extract incoming context and the HTTP-client
   instrumentation inject outgoing context. Check
   [OrdersApplication](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java)
   and [InventoryHttpClient](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java).
   Add application spans only for genuinely additional internal work.
4. Carry context explicitly across custom executors/async servlet dispatch.
   The sample restores `OperationContext.parentContext()` and binds its business
   ID inside the worker, then closes both scopes:

```java
try (var parent = context.parentContext().makeCurrent();
     var scope = Correlation.bind(context.invocationId())) {
    return execute(sku, context, budget, state);
}
```

This is an excerpt from `InventoryHttpClient`, **not** a standalone method:
`execute`, budget and cancellation state belong to that bounded client.
Do not replace it with an unbounded executor or lose its remaining deadline.

Verify missing/invalid/duplicate carriers with the real ingress tracer.
Policy header deletion alone does not prove when a native Gateway span chose
its parent. Keep live trust-root/timing proof requirements; an invalid
`tracestate` alone must not break a valid trace parent.

## 6. Add business correlation without turning it into authentication

Default Application Insights correlation is not this sample's business-ID
contract. Reuse [correlation-core](../../services/correlation-core) and
[security-core](../../services/security-core):

1. Authenticate the caller and independently verify Gateway proof at Orders.
   Preserve the original caller Authorization through APIM; use the separate
   `X-Contoso-Gateway-Authorization` proof. Inventory authenticates Orders.
2. Resolve `x-business-invocation-id` with `InvocationIds.resolve` and the
   verified caller's trusted-issuer decision. Do not trust an arbitrary public
   header merely because it looks like a UUID.
3. Bind `business.invocation_id` on the active request/span/log context using
   `Correlation.bind`, propagate the canonical value downstream and return it
   on responses. Do not use it as a trace ID, access token or authorization rule.
4. Persist the original workflow business ID. A later GET has a new current
   action ID; return the original as `workflowBusinessInvocationId` rather than
   overwriting it with the GET header. Replacing a business ID never resets
   otherwise valid trace context.
5. Preserve the sample's `202` durable staging semantics. Waiting for worker
   `COMPLETED` changes the scenario; it is not required synchronous fulfillment.

## 7. Replace unsafe data auto-collection with safe logical operations

For **this sample's** data/privacy contract, port
[PgRedisInventoryDataAdapter](../../services/inventory-data/src/main/java/com/contoso/inventory/data/PgRedisInventoryDataAdapter.java),
the [correlation data helpers](../../services/correlation-core/src/main/java/com/contoso/correlation/data)
and coordinated [agent configuration](../../config/java-agent.json) / startup
suppression settings.

- Disable the matching JDBC/Redis collectors and keep them disabled when using
  the logical wrappers. Otherwise duplicate spans and raw command/parameter
  telemetry can violate the contract. Do not disable HTTP instrumentation.
- Use bounded logical PostgreSQL and Redis CLIENT spans, parameterized SQL,
  deadlines and allowlisted metadata; do not record SQL text, parameter values,
  cache keys/values, tokens or exception messages.
- Do not create fictitious PostgreSQL/Redis SERVER spans. A database server is
  not assumed to continue the distributed trace.
- Use a captured run-owned cache miss when proving both data boundaries: a warm
  cache hit legitimately skips SQL. Never flush a shared cache to obtain a miss.
- Bootstrap actual schemas/principals before Azure runtime startup, including
  V002 for order staging; the App Insights ARM setting does not create data or
  grant data access.

## 8. Validate sampling, privacy and the actual graph

Keep the sample's parent-safe sampling behavior: a valid unsampled continuation
must not be promoted. Default rate limits, APIM fixed sampling, browser sampling
and ingestion caps are separate controls. For positive full-chain acceptance,
use an approved finite window, observe each participant, admit bounded traffic,
drain/flush/query, then restore and verify the original settings. Do not leave
100% sampling enabled indefinitely or treat a sampling flag as delivery proof.

Run the [focused local tests](GETTING_STARTED.md#focused-tests), repeat the local
rehearsal, then follow [Azure exercise and observation](GETTING_STARTED.md#f-exercise-and-test-azure)
only after its blockers/approvals are resolved. Use the existing
[KQL procedures](../../kql/README.md) with observed IDs and finite bounds.
For the positive Azure path, verify the unchanged
[boundary map](../../contracts/expected-boundary-map.v1.json):

- One actual trace with unique actual span IDs and all eight boundary types.
- Direct parents: browser -> Gateway request -> Gateway backend -> Orders request
  -> Orders Inventory dependency -> Inventory request.
- PostgreSQL and Redis logical CLIENT operations directly under Inventory.
  Additional connected spans remain visible; do not delete them to fit a diagram.
- Canonical business ID continuity, distinct role mapping, no duplicate
  instrumentation, no unsafe original telemetry, and working negative controls.
- Durable read-back, run-owned state restoration, sampling restoration and a
  repeat run. An HTTP 202 or Application Map screenshot alone is insufficient.

The native acceptance adapter, observer enrollment and live recovery proof are
still open. This checklist does not turn the local rehearsal or the parallel
observation-only operator into certified Azure acceptance.

## 9. Roll out incrementally and retain a way back

Review the ARM what-if and package hashes. Deploy to an isolated approved
environment first; change one instrumentation owner at a time, checking health,
duplicate telemetry, parent edges and privacy before proceeding. Keep the prior
approved package/configuration and scoped data baseline. On failure, stop new
traffic, drain, restore run-owned state and sampling, and redeploy the prior
approved package/settings through the normal guarded path. Never solve a
telemetry or deployment failure by weakening authentication, exposing SCM,
logging credentials or purging shared data.
