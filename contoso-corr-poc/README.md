# Contoso correlation POC — staged root preparation

**Preparation only. NOT CERTIFIED.** The user approved the bounded `centralus`
POC design, not Azure provisioning, spending, grants, secret writes or code
deployment. No cloud action is executed by the root preparation tools.

## Engineering demo microsite

Run `npm run microsite:serve` from this directory and open
`http://127.0.0.1:4174`. The separate [microsite](web/demo-microsite/README.md)
provides a searchable scenario walkthrough, source-derived boundary graph,
scoped historical local evidence, embedded source documents and configurable
environment launch links. It does not execute demos or access Azure.

`npm run microsite:build` produces a single offline HTML page;
`npm run microsite:test` runs its focused tests. Configure actual environment
URLs in the site's settings; launch controls remain disabled until configured.
Source snapshots and local receipt matches are explicitly not certification.

## Storefront Demo 01 routing

The Storefront's Demo 01 action uses ordinary order submission
(`POST /contoso/v1/orders`) and order refresh, so the existing Orders handler
can call Inventory. Other SPA demo actions use `/contoso/v1/demo-runs`;
Demo 02 remains Portal-only. The routing correction has independent loopback
browser-fixture validation, not deployed Gateway/Java/PostgreSQL/Redis proof.

## Coherent root

`infra\main.bicep` composes the merged network, telemetry, compute, data,
messaging, Key Vault, APIM and scoped permission modules. One workspace-based
Application Insights resource and one Log Analytics workspace serve
`contoso-corr/poc`; canonical service names remain separate.

The single `contracts\expected-boundary-map.v1.json` declares parents and
bounded links. `docs\ARCHITECTURE.md` is generated from that map. It is not
observed topology. A separate `conditionalRoots` list describes A03 candidates:
R7/R9 must independently bind actual carrier disposition and native null-parent
receipts (`contoso.native-trust-root.v1`) to the exact `policyRef`. Deleting a
header, replacing a business UUID or rejecting state alone never proves a
tracer reset. Valid higher-version context unexpectedly rooted is a gap.

Actual Fulfillment/Notification identities own replay PROCESS and SEND work.
Replay and result SEND roots link their original persisted contexts. Fan-in is
an INTERNAL root with four actual contributor/received SEND links; Event Hubs
batch roots link producers and parent each real item. Database and broker
servers are not invented spans: PostgreSQL/Redis are safe CLIENT boundaries.

## Stages and external prerequisites

1. **Foundation** creates the declared VNet/subnets, LAW/App Insights, Standard
   messaging/storage, Standard RBAC Key Vault, compute identities and Developer
   external-VNet gateway. It contains no application client GUID defaults, HMAC
   secret version or secret value. No application package is deployed; unresolved
   Key Vault references and absent application bindings are not readiness.
2. After separately approved resource creation, R8/root bootstrap generates and
   sets the App Insights reference secret and HMAC key. Record the actual
   existing HMAC version and actual Entra client/object pairs.
   Record the actual foundation `inventoryBaseUrl` and `portalOrigin` outputs;
   do not derive hostnames from frozen resource names. SQL migration, OID-bound
   users, column-restricted grants and dataset markers are separate
   approved R6/R8 bootstrap work, never application startup.
3. **Application** requires those actual inputs, binds exact named-secret
   readers and the APIM logger, API policies, data services and messaging roles.
   It still does not deploy code or certify native behavior.
4. Current-source build/loaded-byte proof, version/GA review, quota/cost/policy,
   owner approvals, package identity and authenticated deployment-runner routing
   precede separately authorized code deployment and live certification.

The candidate parameter file intentionally leaves publisher contact and
deployment approval unset. These fail preflight; they are not false valid
defaults. Do not replace unknown client/object GUIDs with fixture identifiers.
Foundation application/admin objects must be empty. Application/admin,
principal, controller and database-role schemas are sealed before parameter
rendering. Normalized/prefixed credential keys are rejected without logging
their values. Every IPv4 `/0` is rejected regardless of host bits; allowed
CIDRs are rendered as canonical network ranges.

### Exact input/output contract

| Input | Contract |
|---|---|
| `names` | Exact `infra\params\frozen-names.v1.json`, generated from approved subscription `474c40eb-d385-40d8-baa2-06883dbdca2d`, `centralus`, `poc`; availability remains unverified |
| `deploymentPhase` | `foundation` or `application`; empty application bindings only in foundation |
| `publisherName/publisherEmail` | Contoso and the separately approved contact |
| `applicationConfiguration` | Actual tenant, Orders/Inventory registration GUIDs, Storefront client GUID, foundation `inventoryBaseUrl` (HTTPS default hostname plus `/api`) and `portalOrigin`, controller pair, seven compute/gateway client-object pairs, registered database roles, approved test allowlist and approved existing 32-lowerhex HMAC version |
| `postgresAdministrator` | Actual approved object GUID, principal type and name; never runtime administrator credentials |
| `scmRunnerCidrs` | Explicit approved authenticated runner routes; no `0.0.0.0/0` |
| `notificationActionGroupIds` | Actual approved action groups; empty disables routes and leaves governance unmet |
| `deploymentApprovalReference` | External approval locator; a caller string does not establish authority |

Outputs contain resource IDs, URLs, declared names and actual ARM identity
object references, never a connection-string/iKey/key/token value. HMAC
reference configuration means syntax/reference selection, not secret existence
or approval. Foundation returns no HMAC versioned URI.
Foundation Inventory and Portal URLs come from actual site `defaultHostName`
outputs. Application settings consume the approved captured Inventory URL, not
an output from the same compute invocation; no compute dependency cycle exists.

API main-site access is denied by default except the authorized gateway and
integration subnet service-endpoint paths; caller and gateway JWTs are still
independently validated. Portal is browser-public. SCM has separate deny-default
runner rules and Basic SCM/FTP credentials disabled.
The root supplies API, worker and separate SCM restriction arrays at site
creation. It does not partially replace `web` settings in a post-compute module.
VNet integration is egress, not private deployment-runner routing or universal
Private Link. Timer-host
storage permissions are scoped to the owned host/secrets blob containers;
messaging entity grants remain distinct. Actual reachability/host permissions
must be demonstrated before deployment.

### Workbook composition

Root v4 passes the accepted R7 `workbooks\contoso-correlation.workbook.json`
through the existing telemetry module's `workbookSerializedData` input.
The module declares its shared workbook against the same Application Insights
resource already attached to the sole Log Analytics workspace; no extra
workspace, component or telemetry provider is introduced. Root exposes the
module's actual `workbookResourceId` output, not an invented deployed ID.

The candidate hashes this R7-owned derived artifact separately from root-owned
source and checks the compiled ARM's exact serialized bytes, current boundary-map
hash and shared resource bindings. V3 and its accepted source reviews remain
historical; they did not include this workbook caller binding.
This is preparation only. Azure import/render, actual resource parameter
selection and screenshots are unrun. Conditional-root candidates remain
`UNVERIFIED` without independently enrolled native runtime/carrier evidence;
neither the workbook nor its resource declaration certifies the graph.

## Local bounded commands

Use the existing frozen Bicep executable; no global/duplicate install:

```powershell
Set-Location .\contoso-corr-poc
$env:CONTOSO_BICEP_PATH = '<existing frozen Bicep 0.48.1 executable>'
.\tools\Prepare-Root.ps1
node --test --test-reporter=spec .\tests\root-composition.test.mjs .\tests\architecture.test.mjs .\tests\names.test.mjs .\tests\certification-path.test.mjs
node .\tools\architecture.mjs --check
node .\tools\root-preflight.mjs --input '<approved non-secret root input JSON>'
```

Root input JSON has schema `contoso.root-inputs.v1` and fields matching the
table plus subscription/resource-group/location. Compiled foundation parameters
remain structurally valid but intentionally incomplete for provisioning.
Preflight returns syntax findings and independent evidence prerequisites, never
an authorization or certification PASS. `.cache\acting-r1` is local compiler
scratch and must not enter deployment packages.

R2's corrected source-free Portal cohost artifact must be consumed with its
current tree hash and production-only dependency restore, not the repository,
browser cache or a stale dist tree. Parent owns Java packages, Maven/compute
startup and version locks. No root tool launches Maven/native probes or Azure.

## Immutable correctness boundaries

- Use only `x-business-invocation-id` / `business.invocation_id`; UUIDs are not
  authentication, technical IDs or metric dimensions.
- APIM preserves original caller Authorization and adds independent
  `X-Contoso-Gateway-Authorization` managed-identity proof. v2 audiences are bare
  registration GUIDs; OAuth request resources/scopes use separately registered
  `api://` values. Inventory token resource is not its verifier audience list.
- The approved same-provider 1.1.0 guard drops valid unsampled parents and
  no-parent roots with nonempty all-valid-unsampled links; sampled/mixed/unlinked
  roots delegate. Current immutable hash/loaded behavior comes from the parent
  version lock and actual evidence, not this README. No second provider or
  traceparent/sampled-bit repair is added.
- Approved identity HTTP mode is `header_isolation_only`: eligible identity
  CLIENT spans remain in the same provider, public identity header isolation
  is enforced, and raw unfiltered native-context traffic is a visible negative
  control. The ineffective OkHttp-disable switch must not be claimed honored.
  Business Grid/Queue Netty and injected modes remain explicit.
- The actually resolved Node exporter `1.0.0-beta.46` support/GA classification
  is **OPEN**. It is not silently labelled GA or added to a certified path.
- Native APIM advancement/strict `00`, secret rotation/MI ingestion, every
  actual identity attempt, current source/build/USED lineage, full-role graph,
  arbitrary URL/body/header privacy, SCM, SQL grants, retention/purge and reset
  require independent evidence. Static compilation and expected maps do not
  certify them. Only R9 updates the board; no card is Done on this candidate.
