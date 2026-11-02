# DAT-01.1: one run-owned cold inventory fixture

This is construction code, not PostgreSQL/Managed Redis qualification, native
readiness, authorization, a completed DAT-01 card, or an administrative web route.
H2 and the loopback RESP peer are local test substitutes only.

## Production Java lifecycle

`InventoryFixtureRun.capture(operatorPg, restorableCache, existingPermit, lease,
operationContext)` reads the baseline without changing data. Retain the returned
object **before** calling `prepare(context)`. Call `reset(context)` on that same
object after stopping/draining the run, including after a preparation failure.
Both clients are borrowed; the lifecycle does not close them.

`Lease(runId, orderId, sku, unownedCacheWitnessSkus)` requires nonzero UUIDs, one of
V001's five approved synthetic SKUs, and at most sixteen distinct explicitly
declared cache-witness SKUs other than the fixture. The SKU must already exist,
be synthetic, have no preexisting reservations, and the fresh order ID must not
already occur in any reservation. A synthetic flag alone never grants run
ownership. The operator's external exclusive lease is still required: the Java
object is not a distributed resource lock.

Capture retains the real item's name/quantity/revision/synthetic flag, the
owned cache's canonical value/presence/expiry, a fingerprint of all other
inventory items and reservations, and the declared cache witnesses privately.
`prepare` rechecks the baseline, seeds only the selected item's quantity 20 /
revision 1, commits, then evicts and verifies absence of only that cache entry.
The measured application invocation calls the existing
`PgRedisInventoryDataAdapter.lookupInventory`: a cold lookup performs GET,
SELECT, SETEX; a subsequent hit performs GET only. Preparation is outside that
measured invocation. Adapter cache errors remain `ERROR`, never a successful
`MISS` qualification.

Reset checks the target/marker, unrelated fingerprints and allowed current
state before mutation. It deletes only an actual locked reservation matching
**reservation ID + fresh order ID + selected SKU + independently observed
measured business invocation ID + synthetic=TRUE**. The reset context must
carry that observed invocation ID, not an expected-map ID or a newly invented
ID. The known reserve/release stock/revision effects must match. Baseline
reservations are never deleted; capture rejects them. Unrelated or unexpected
reservations, values, row changes and marker drift fail closed, not "repair"
unowned state. The original captured quantity/revision is restored, not a
hard-coded reset default.

`RestorableInventoryCache` adds only typed capture/restore to the existing owned
cache abstraction. The real Lettuce implementation uses GET/PTTL to capture,
SET with PXAT to restore an expiring entry without renewing its original TTL,
SET for a persistent baseline, and DEL for an absent/naturally expired baseline.
Canonical cache encoding is required before mutation so byte-different
noncanonical values are not normalized during reset. Absolute expiry is
conservatively captured before the PTTL request; verification permits at most
one second of capture-time uncertainty, never an unconditional new 60 seconds.
No global enumeration, flush, script, raw-command API, per-key hash or key/value
telemetry is added.

`ResetReceipt(runId, expected, observed)` is returned only after actual
read-back and equality checks. Hash fields are `ownedRowsSha256`,
`unownedRowsSha256`, `cacheContentSha256`, and
`unownedCacheContentSha256`. Cache content fingerprints include values,
presence and persistent/expiring mode, not cache keys or exact TTL numbers;
expiry is checked separately, with natural expiration accounted for at reset
time. Unowned cache coverage is **only the declared witnesses**, not an
assertion about an enumerated Redis database. SQL hashes cover the two V001
inventory tables, not workflow tables. No receipt asserts message drain, flags,
sampling restoration, privacy/native collection or all-service readiness.

An exception returns no success receipt. Unknown ACK/commit outcomes retain
the handle in `PREPARE_FAILED` / `RESTORE_FAILED`; there is no automatic command
replay. A separately requested reset re-reads current state before changing it.
Before the first reset mutation the handle now retains a private, validated
restore checkpoint: exact pre-restore item/reservation identities, observed
cache presence/value/expiry, and the measured invocation ID. An explicit retry
requires the same invocation, unchanged unrelated state, SQL matching either
that exact pre-restore state or the captured baseline with no owned
reservations, and cache matching either the checkpoint or captured baseline
(including expiry checks). The checkpoint is cleared only after all restoration
read-backs succeed. Thus a committed SQL reset followed by a cache failure
**before** application can retry its still-owned reservation-derived cached
value; SQL reservation deletion no longer erases that validation. Recreated
reservations, changed cache values/expiry, other SQL/cache drift and a changed
invocation fail closed rather than widening a retry's allowed state.
Successful repeated reset is read-back/idempotent. Conflicting state is left
untouched for the authorized operator to reconcile.

The earlier author freeze / 46-Java-test receipt is historical, not acceptance
for this correction: independent R8 review found that it omitted this
fault-before-cache-mutation retry. The new focused regression was observed to
fail with `data_conflict` on the original production source before the
checkpoint correction. Both old and new run witnesses use separate isolated
output directories; no historical receipt is overwritten. This remains
**live-handle retry only**, not durable recovery or real-store qualification.

## Fixed process bridge for a Node adapter

The supplied main class is
`com.contoso.inventory.data.InventoryFixtureStdio`. Its only accepted argv is
`--approved-operator-stdio`. Invoke the fixed class with an independently
verified Java executable and a **newly integrated, hash-pinned complete runtime
classpath**. A historical installed JAR, arbitrary executable, caller callback
or source declaration is not that build. The class uses the existing
`IdentityHttpClients.defaultCredential()` explicit operator path and the same
credential instance with the real `EntraPgConnectionFactory` and
`LettuceInventoryCache`. Existing environment contracts supply targets/roles;
no credentials or deployment configuration are generated. This explicit argv
is a caller/execution guard, **not authentication or approval by itself**.
Actual Entra authentication/permissions and separate operator approval remain
mandatory. Stores open only after a syntactically valid CAPTURE.

Stdin is ASCII, tab-delimited, one line per command, at most 1,024 bytes per
line and 64 commands per process. Budgets are integer milliseconds 1..30000.

```text
CAPTURE <runUUID> <freshOrderUUID> <approvedSKU> <preparationInvocationUUID> <budgetMs> <comma-separatedWitnessSKUs-or-"-">
PREPARE <sameRunUUID> <preparationInvocationUUID> <budgetMs>
RESET   <sameRunUUID> <observedMeasuredInvocationUUID> <budgetMs>
QUIT    <sameRunUUID>
```

Spaces above stand for **tabs**, not shell arguments. `QUIT` is accepted only
after a verified reset. One process retains one captured run. Responses are
JSON lines with schema `contoso.inventory-fixture-stdio.v1`:

* CAPTURE: `command`, `runId`, `state: "CAPTURED"`, `hashes`.
* PREPARE: `command`, `runId`, `state: "PREPARED"`.
* RESET: `command`, `runId`, `state: "RESTORED"`, `expected`, `observed`.
* QUIT: `command`, `runId`, `state: "RESTORED"`.
* Failure: finite `error` category and `outcomeUnknown`, without input echo,
  SQL, keys, values, tokens or exception causes.
* EOF/command exhaustion before reset: `error: "INCOMPLETE_RESET"`, exit 3.
  Oversized/non-ASCII input or EOF without a captured run exits 2.
    Cleanup/output failure exits 4. A normal completed session exits 0.

**Explicit missing recovery contract:** the private baseline exists only in
the original live process/Java handle. There is deliberately no restore from
caller-supplied saved JSON, hashes or a newly started process. Consequently
DEM-00.1 `restoreCapturedRun(saved summary)` is **not implemented** by this
bridge. An authenticated durable journal/daemon, operator-protected storage,
ownership/provenance and crash-recovery lifecycle require a separately
approved contract. Retain the live handle through reset; do not claim a saved
summary supplies that missing authority.

## Exact real-store prerequisites (not executed here)

1. A separately approved bounded data execution/reset window, authorized
   operator identity, exclusive owned synthetic fixture/order lease, and
   stopped/drained conflicting inventory mutation traffic (including
   cache-populating lookups of the fixture/witnesses). Keep that lease
   until verified reset; freeze unrelated inventory state during hash checks.
2. Approved INF-05 deployment: actual PostgreSQL `contoso_orders` and actual
   Azure Managed Redis, private DNS/routes/reachability, original approved
   hostnames and full TLS/certificate verification. H2/RESP cannot satisfy it.
3. V001 applied by the separately authorized migration runner, exact bound
   resource/workload/environment/seed marker and approved existing synthetic
   item. No migration, grant, role creation or startup initialization is
   performed by this lifecycle. V002/workflow setup and drain are separate
   Demo 01 prerequisites, outside these receipts.
4. An existing independently approved OID-bound **operator** PostgreSQL role:
   CONNECT/USAGE, SELECT on the three V001 tables, UPDATE sufficient for the
   marker/item `FOR UPDATE` locks, UPDATE of item available/revision, and DELETE
   of exact run reservation rows. No runtime application grant is broadened;
   no CREATE/DROP/TRUNCATE, role administration or server-admin permission is
   required by the preparation code. Effective/inherited permissions must be
   reviewed independently. Existing application runtime grants do not permit
   this reset and must not be used as if they did.
5. Approved actual Managed Redis principal/default Entra policy and renewed
   authentication. Required data commands are GET, PTTL, SETEX, SET (including
   PXAT support), DEL and readiness PING. No global command permission or new
   role assignment is created here.
6. Existing environment inputs: CONTOSO_PG_HOST, CONTOSO_PG_DATABASE,
   CONTOSO_PG_USERNAME (operator role for this process), CONTOSO_PG_RESOURCE_ID,
   CONTOSO_REDIS_HOST, CONTOSO_REDIS_PRINCIPAL_ID, optional AZURE_CLIENT_ID and
   the existing service identity/manual JDBC+Redis instrumentation guards.
   The existing credential/HTTP/provider and logging safety policies still
   apply; inputs or saved approval booleans alone are not authorization.
7. Fresh reviewed integrated Java artifacts/classpath hashes for this changed
   source, independently reviewed operator authentication/source capability,
   bounded timeouts, a retained live baseline handle, and an authorized
   actual probe that observes the measured GET/SELECT/population and verified
   restoration. That probe and its telemetry/privacy/source evidence have
   **not** been run or inferred from local results.

## Focused offline validation

From the repository root, using already installed portable tools/cache:

```powershell
.\contoso-corr-poc\services\inventory-data\tools\Test-InventoryFixture.ps1
.\contoso-corr-poc\services\inventory-data\tools\Test-InventoryFixture.ps1 -RetryReproductionOnly
node --test --test-reporter=spec .\contoso-corr-poc\services\inventory-data\tools\data-source-contract.test.mjs .\contoso-corr-poc\services\inventory-data\tools\inventory-fixture-source.test.mjs
```

The runner clones the module POM into its own ignored tools\.java-work run
directory, uses Maven **offline test only**, and writes only isolated module
outputs. It installs/downloads nothing, never runs a reactor/native test, and
records fresh test counts plus before/after source hashes in validation.json.
Tests exercise the production lifecycle/bridge with H2, deterministic cache
faults and real Lettuce against a local bounded RESP peer. These are explicitly
construction results, not an integrated deployment or real-store proof.
