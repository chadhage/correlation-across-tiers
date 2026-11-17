# Azure-backed examples: Contoso Demos 01-15

These are executable Azure examples, not mock telemetry and not certification.
They use the existing Gateway, Orders, workers, PostgreSQL, Managed Redis and
telemetry resource. The optional module adds three separate App Service hosts:

- **Operator:** authenticated, finite-window controls and durable recovery.
- **Watchdog:** the same recovery implementation, with no public control API.
- **Inventory fixture:** a test-only Inventory implementation using the real
  data adapter, the existing single Java agent and isolated fault controls.

Do not install the fixture in a production Inventory deployment. Use a dedicated
POC environment with exclusive ownership of synthetic `CONTOSO-001` stock.
The [local Demo 01 rehearsal](../../demos/01/GETTING_STARTED.md) remains separate.
Its H2/RESP results are not Azure results for these examples.

**This source change authorizes no provisioning, grants, secret access, deployment,
traffic or spending.** The commands below that contact Azure are for a separately
authorized operator. Preparation and unit tests need no Azure credentials.

## What each example actually does

All handlers are in [azure-scenarios.mjs](../../tools/verification/azure-scenarios.mjs).
The [client adapter](../../tools/verification/adapters/azure-operator.mjs) supplies
concrete authenticated HTTPS, browser driving, raw capture and bounded polling.

| Demo | Azure execution and checks |
|---|---|
| 01 | Actual Storefront SDK order submission; worker completion; native browser/Gateway/Orders/Inventory parent chain and data CLIENT operations. |
| 02 | Actual Portal controller session and form POST; Storefront/page telemetry versus the independent SSR root and downstream native chain. |
| 03 | Four real sampled/absent/invalid/unsampled Gateway requests; native roots/continuation plus actual Inventory SDK sampled/recording observations. |
| 04 | Delegated untrusted business ID, malformed ID, trusted operator ID; actual six-table business lookup compared with persisted workflow contexts. |
| 05 | Isolated Inventory delay and real PostgreSQL division error; actual failed Orders responses, SDK observations and associated native exception. |
| 06 | Two failures followed by success; all three native PROCESS spans, unique identities and exact persisted producer parent. |
| 07 | Topic delivery to Fulfillment and Notify; actual dead letters, actor-specific replay controls and linked native replay SEND roots. |
| 08 | Real fan-out and result outboxes; native INTERNAL aggregation links compared with four persisted PROCESS/SEND contributors. |
| 09 | Two independently traced Event Hubs publications, co-located by workflow partition key; native mixed batch must actually contain both links. |
| 10 | Real Event Grid and Storage Queue workflows, exact persisted-envelope redelivery, durable duplicate observations and one business effect. |
| 11 | Run-owned spoofed/invalid/oversized Service Bus messages; actual broker DLQ reason observations and narrowly scoped cleanup. |
| 12 | Actual SQL literal/parameter and read-only Redis key/value/script/argument canaries; original raw-column scan and a separate scanner rejection control. |
| 13 | Actual delegated `/me` pseudonym, native pseudonym attribute and rejected invalid bearer; tokens are never evidence. |
| 14 | Actual bounded orphan-candidate query; candidates without an observed canonical parent or independent justification fail, rather than disappear. |
| 15 | Bounded Gateway load, APIM sampling configuration/restore, measured HTTP latency, actual plan CPU/memory and `_BilledSize`; unsupported overhead/loss conclusions remain inconclusive. |

An Event Hubs transport can still split deliveries. Demo 09 fails if the real
mixed batch is not observed; it never invents links or chooses the first parent.
Native schema/role/ID serialization differences also fail explicitly. Review
actual evidence and the existing contracts rather than relabelling native rows.

## 1. Build and validate locally

From `contoso-corr-poc`, select the existing checksum-verified portable tools:

```powershell
. .\tools\java\Use-Portable.ps1
mvn -B -ntp -Pazure-examples -pl :contoso-azure-demo-operator -am package '-Dtest=OperatorRunStoreTest,RequestAuthenticatorTest,AzureSdkBoundaryTest,PgMessagingStoreTest,DemoWorkflowRoutingTest' '-Dsurefire.failIfNoSpecifiedTests=false'
node --test tests\verification\azure-examples.test.mjs tests\verification\demo.test.mjs tests\security\native-payload.test.mjs
npm run examples:azure -- --list
```

The module is opt-in. The default eleven-module reactor is unchanged. The
selected tests use local keys/H2/checker transports, not Azure or native agent
qualification. Rebuild the existing APIs/workers with the changed shared
security/messaging code before deploying the examples.

For browser cases, use the existing Portal dependency restore and compilation
instructions, including `npm run test:prepare`. The actual Playwright browser
must be installed. Authenticate through the real approved Storefront flow.
If supplying a Playwright storage-state file, keep it outside the repository;
never commit cookies, tokens or browser profiles. Headful mode permits the
normal interactive sign-in; an unauthenticated action fails explicitly.

## 2. Prepare the isolated hosts

Copy [infra.example.json](infra.example.json) to a private, non-committed input
file. Fill in the actual existing plan/subnet IDs, three new legal host names
and reviewed runner CIDRs. Empty settings represent foundation only, not
working applications.

```powershell
New-Item -ItemType Directory .\.cache\azure-operator -Force
node .\examples\azure-operator\prepare.mjs --input '<actual non-secret infrastructure inputs>' --output .\.cache\azure-operator\parameters.json
```

Preparation reuses the root CIDR validator, rejects universal routes and
plaintext credentials, and performs no Azure calls.
[infra.bicep](infra.bicep) creates only the three isolated hosts on the existing
plan, with deny-default main/SCM access, disabled Basic SCM/FTP credentials and
VNet egress integration. The fixture accepts the Orders integration subnet;
operator ingress accepts only the approved runners. VNet integration is not a
claim of Private Link or native connectivity.

After separate cost/capacity, deployment and network approval, validate/what-if
and deploy that template through the existing authenticated runner. Capture its
actual host URLs and principal object IDs. Resolve each system-assigned
identity's actual client ID from Entra; object and client IDs are not interchangeable.
No registration GUID is supplied by the sample.

### Required identity and access configuration

Use separate Entra-bound database roles and the existing R6 bootstrap procedures.
Do not make a runtime principal the database administrator.

| Principal | Required approved access |
|---|---|
| CLI/controller workload | App-only `Demo.Control` on the operator audience; the exact client/object pair configured at the operator. Portal control also requires its exact approved pair and `Demo.Control` on the Orders audience. |
| Operator managed identity | Orders `Portal.Invoke` plus `Demo.Control`; exact pair in Orders' optional operator allowlist. APIM diagnostic read/write, workspace query, plan metrics read, queue-scoped Service Bus send/receive, Event Grid send and Storage Queue message send. |
| Watchdog managed identity | Recovery database/cache rights, the same diagnostic read/write scope and run-owned DLQ receive. It needs no public control API or Orders invocation permission. |
| Inventory fixture identity | Existing Inventory data permissions, exact named AI-secret reference read and the restricted fixture observation function. It accepts only the real Orders workload with `Inventory.Invoke`. |

The operator must never receive `Gateway.Invoke`. APIM still adds and Orders
independently verifies the separate gateway proof.

On the isolated Orders deployment, set `CONTOSO_DEMO_OPERATOR_CLIENT_ID` and
`CONTOSO_DEMO_OPERATOR_OBJECT_ID` to the actual operator identity. Both are
required, must differ from Portal/Gateway, and do nothing when absent.
Include that actual client ID in the reviewed APIM client-application allowlist
and append it to `contoso-portal-client-ids`, preserving the existing Portal ID.
This is explicit workload authorization, not authorization by a business UUID.

Point that isolated Orders deployment's `CONTOSO_INVENTORY_BASE_URL` to the
actual fixture origin plus `/api`, retaining the real Inventory token resource
and verifier audience. Do not change the ordinary application environment.

### Operator environment

Supply these non-secret values to operator and watchdog, using their own
database role/principal. System-assigned identity normally needs no
`AZURE_CLIENT_ID` selector.

```text
CONTOSO_TENANT_ID
CONTOSO_OPERATOR_AUDIENCE                  actual v2 bare registration GUID
CONTOSO_OPERATOR_CONTROLLER_CLIENT_ID
CONTOSO_OPERATOR_CONTROLLER_OBJECT_ID
CONTOSO_OPERATOR_GATEWAY_URL               actual HTTPS origin plus /contoso/v1
CONTOSO_OPERATOR_ORDERS_RESOURCE            actual api://Orders-registration-GUID
CONTOSO_OPERATOR_WORKSPACE_ID
CONTOSO_OPERATOR_APPINSIGHTS_RESOURCE_ID
CONTOSO_OPERATOR_COMPUTE_PLAN_RESOURCE_ID
CONTOSO_OPERATOR_APIM_DIAGNOSTIC_RESOURCE_ID
CONTOSO_OPERATOR_START
CONTOSO_OPERATOR_END
CONTOSO_OPERATOR_APPROVAL_REFERENCE
CONTOSO_PG_HOST
CONTOSO_PG_RESOURCE_ID
CONTOSO_PG_DATABASE                         contoso_orders
CONTOSO_PG_USERNAME                         actual OID-bound service role
CONTOSO_REDIS_HOST
CONTOSO_REDIS_PRINCIPAL_ID
CONTOSO_SERVICE_BUS_NAMESPACE
CONTOSO_EVENT_GRID_ENDPOINT
CONTOSO_EVENT_HUBS_NAMESPACE
CONTOSO_STORAGE_QUEUE_ENDPOINT
CONTOSO_DB_ROLE_ORDERS
CONTOSO_DB_ROLE_FULFILLMENT
CONTOSO_DB_ROLE_NOTIFY
CONTOSO_DB_ROLE_AGGREGATOR
```

The APIM diagnostic ID must identify the root's service-level
`.../service/<service>/diagnostics/applicationinsights`, not an API-scoped
diagnostic. Demo 01 verifies durable staged-order read-back without waiting for
worker completion. Its reset still rejects pending or leased outbox work;
worker-free cleanup is not yet implemented and the fence must not be bypassed.

Use the existing Inventory environment for the fixture, including the actual
Orders pair, Inventory audience, private data targets and resolved Key Vault
reference. Set the same data-capture-disable flags as the main Inventory API.
The Bicep template fixes isolation/mode/platform-agent settings.

## 3. Bootstrap durable state and bounded runtime files

On a separately approved private bootstrap runner/identity, execute the built
JAR with `--approved-migrate`. This explicitly installs
[operator.sql](src/main/resources/db/operator.sql); application startup never
installs schema or grants. That command needs the approved bootstrap PG identity,
not the restricted runtime database role.

Generate and review the PostgreSQL-specific grants/function using the actual
existing OID-bound role names:

```powershell
.\examples\azure-operator\Prepare-Grants.ps1 -OperatorRole '<actual operator role>' -WatchdogRole '<actual watchdog role>' -FixtureRole '<actual fixture role>' -OutputPath .\.cache\azure-operator\grants.sql
```

Apply the generated SQL as the approved database owner, with TLS verification.
The fixture can execute only a checked observation-insert function; it cannot
forge operator sampling baselines or change a run. Local H2 tests do not
qualify this PostgreSQL-specific security-definer function or actual Entra grants.

Prepare a fresh window of five minutes to one hour, matching the stricter Java
run-control limit:

```powershell
node .\examples\azure-operator\prepare.mjs --prepare-window --start '<approved UTC start>' --end '<approved UTC end>' --approval-ref '<external approval locator>' --output .\.cache\azure-operator\window
```

This writes reviewed inputs only: native agent JSON, per-JVM runtime leases,
operator dates and application window settings. It creates no runtime ACK.
For each application, stage the matching role's `agent` files next to its
configuration, configure `CONTOSO_SAMPLING_LEASE_FILE`, and restart through the
existing approved deployment process. Apply only the relevant frontend window
settings to Portal. Preserve all original capture/isolation settings.

Every example temporarily raises the owned APIM diagnostic's sampling to 100
with its actual ETag. Its original fixed-sampling baseline must be below 100.
Native Java/browser/Node sampling, Functions host/backend policy and actual
participant readiness are separate prerequisites; a setting is never proof of fidelity.

Package the same source-free JAR for the three modes:

```powershell
.\examples\azure-operator\Package.ps1 -Destination .\.cache\azure-operator\operator.zip -InventoryRuntimeDirectory .\.cache\azure-operator\window\contoso-inventory-api\agent
```

The package checks actual agent/sampler bytes and copies the existing
single-agent launcher for fixture mode. Operator/watchdog refuse injected Java
launcher options and install no telemetry provider. A package without a window
uses the original baseline agent configuration; it is not a full-fidelity run.
Deploy only after separate authorization and verify each actual `/health/ready`.

## 4. Execute the examples

Fill [client.example.json](client.example.json) with actual origins/scopes.
Credential fields name environment variables, never token values. Set an
environment reference to `null` to explicitly select the existing Portal
`DefaultAzureCredential` implementation instead. The resulting identity must
still satisfy the server's signed app-only token, exact pair and role checks.
Cases 04/13 need a real approved delegated Storefront token.

```powershell
npm run examples:azure -- --config '<actual client JSON>' --check
$hash = (Get-FileHash -LiteralPath '<actual client JSON>' -Algorithm SHA256).Hash.ToLowerInvariant()
npm run examples:azure -- --config '<actual client JSON>' --config-sha256 $hash --execute --approval-ref '<same server approval locator>' --demo 06
```

Use `--all` instead of `--demo 06` for all fifteen, stopping at the first
failure. The ordinary entry points also support:

```powershell
.\demos\06\Run.ps1 --azure-examples --config '<actual client JSON>' --config-sha256 $hash --execute --approval-ref '<same server approval locator>'
```

Those flags do not authorize actions: the actual Entra credential, deployed
server configuration, owner approval and active window are all independently
required. There is deliberately no `Certify` route.

## 5. Reset and recovery

The runner always attempts browser stop/drain/flush, server admission stop,
APIM restoration, owned-message cleanup and durable inventory/cache restore.
Recovery after an interrupted client uses the server-owned checkpoint:

```powershell
npm run examples:azure -- --config '<actual client JSON>' --config-sha256 $hash --execute --approval-ref '<same server approval locator>' --reset --run-id '<actual server run UUID>'
```

The watchdog repeats recovery for expired leases. It never replaces an
unacknowledged RP operation with success, overwrites a foreign revision, purges
unowned messages or steals an unresolved lease. A foreign DLQ head, interrupted
fixture observation or uncertain control outcome requires owner reconciliation.
Recovery failure remains visible and the next run cannot acquire the lease.

Workflow/publication/attempt audit rows are intentionally retained. Broker
checkpoints never rewind. Reset restores the captured synthetic stock/cache
baseline, including expiry, not a byte-for-byte rollback of all platform history.
Restore the other applications' original packages/settings using the existing
approved deployment procedure; lease expiry stops work, not a production-readiness guarantee.

## Evidence boundary

New packs contain `OBSERVED` or `FAIL`, source hashes, safe native projections,
scoped counts and actual reset results. Six raw tables are scanned in memory
before persistence; duplicates, partial pages, unknown ingestion time and
unverified multi-page keys fail. Rows beyond the watermark are reported,
not silently counted as zero loss. Original raw bags and credentials are not saved.

This is **not** the original full-acceptance adapter capability. Saved JSON,
hashes and this operator cannot enroll an independent R9 observer or provide
an independent complete emission ledger. The original LocalValidate /
BootstrapValidate / Certify guards are unchanged.

Gateway carrier attestation, deployed-byte lineage, all-role ownership, global
privacy, full loss accounting, equivalent uninstrumented overhead baseline,
accountable signoffs and Portal prerelease support classification remain open.
Demo 15 evaluates available measured thresholds, but an otherwise clean load
report remains INCONCLUSIVE where these required measurements are missing.
Use the existing [KQL procedures](../../kql/README.md) and
[residual limitations](../../docs/RESIDUAL_LIMITATIONS.md) for formal follow-up.
