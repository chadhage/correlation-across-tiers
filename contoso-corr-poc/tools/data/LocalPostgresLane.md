# DAT-01.3 — opt-in real local PostgreSQL lane

**LOCAL CONSTRUCTION ONLY — REAL POSTGRESQL EXECUTION NOT EXECUTED.**
The present host has no PostgreSQL binary, `psql`, Docker, or approved local
PostgreSQL target supplied to this lane. No port probe, database connection,
installation, provisioning or secret retrieval was attempted. Actual execution
and its independent review remain **To Do**; source/config tests do not close
DAT-01.3 or any live/native facet.

## Separate safe contract tests from the real lane

`LocalPostgresLaneContractTest` exercises opt-in, target/identifier/port rejection,
redaction and shared grant construction **without opening a connection**.
`LocalPostgresLane` deliberately does not match default Surefire `*Test` names.
It runs only when explicitly selected; missing inputs fail rather than skip.
The R4 build-output lease must be held before running Maven in the active swarm.
No new dependency, Maven profile or server installer is introduced.

The real lane requires an independently approved, existing PostgreSQL **18**
server bound to `127.0.0.1`, an explicit port, and a local administrator supplied
by the operator with CREATE DATABASE / CREATE ROLE rights. Connections check the
actual driver product, server major version and `inet_server_addr()`. SSL is
disabled only for this numeric-loopback **test source**; deployed Entra/TLS
factories and guards are unchanged.

```powershell
# Approved existing local server only; do not point at a tunnel or cloud target.
$env:CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP = 'run-owned-only'
$env:CONTOSO_LOCAL_PG_HOST = '127.0.0.1'
$env:CONTOSO_LOCAL_PG_PORT = '<explicit-local-port>'
$env:CONTOSO_LOCAL_PG_USERNAME = '<existing-local-admin>'
$env:CONTOSO_LOCAL_PG_RUN_ID = [Guid]::NewGuid().ToString()
# CONTOSO_LOCAL_PG_PASSWORD is optional, supplied locally by the operator.
# Do not put credentials in the command, URL, source, evidence or log.

# From contoso-corr-poc, with R4's existing current-source/offline build setup:
mvn -o -B -ntp -pl services\inventory-data -am test '-Dtest=LocalPostgresLane' '-Dsurefire.failIfNoSpecifiedTests=false'
```

The default-safe selection is `-Dtest=LocalPostgresLaneContractTest`; that
selection is explicitly **not** real-store execution.

## What the real lane measures

* Refuse an existing `contoso_local_<runUUID-without-hyphens>` database or its
  `_app` role. Create only those fresh exact names from the explicit run ID,
  using `template0`, and retain live creation flags.
* Apply the production V001 migration twice in the fresh database, bind a
  `local-postgresql:` marker (never a fabricated Azure resource ID), and apply
  the same inventory schema/column grant statements used in production. Seed
  old broad table and direct provenance-column marker grants in that new
  database only, reapply the narrow policy, then measure effective privileges.
* Use a NOLOGIN, NOINHERIT, nonadmin role via local `SET ROLE`. This tests real
  PostgreSQL privilege enforcement, **not Entra** mapping, authentication,
  inherited-production permissions or per-app identity connectivity.
* Call the real `PgRedisInventoryDataAdapter` with real pgJDBC connections for
  lookup, reservation/idempotency, quantity conflict, insufficient stock,
  release/idempotency and stock restoration. `PostgresOnlyCache` is an explicit
  always-miss in-memory cache: this lane makes **no Redis assertion**.
* Check the actual marker row lock, provenance-column/INSERT/DELETE denials,
  absence of TRUNCATE/schema-CREATE privileges and unchanged witness row.
  Denied DML uses zero-row predicates; no broad deletion is attempted.
* After all leases close, DROP only objects whose creation completed in this
  live invocation, then read back exact absence. Existing objects are never
  adopted, reset or dropped. No `CASCADE`, force drop, `pg_terminate_backend`,
  global role cleanup or broad row deletion is used.

The inventory role's only marker UPDATE privilege is `UPDATE(singleton)`.
Prior direct marker privileges are cleared by table `REVOKE ALL`, which also
revokes the corresponding column privileges according to PostgreSQL's
[REVOKE documentation](https://www.postgresql.org/docs/18/sql-revoke.html).
PUBLIC or inherited privileges remain additive and must be measured independently.
V001 constrains that primary-key column to TRUE, so this permits the row-lock
privilege check without permitting changes to resource/workload/environment/
seed provenance. PostgreSQL's [SELECT documentation](https://www.postgresql.org/docs/18/sql-select.html)
requires UPDATE on at least one column for `FOR UPDATE`; H2 tests do not prove
this PostgreSQL permission behavior. Workflow marker grants remain SELECT-only:
worker runtime stores do not take this marker lock.

On unknown CREATE acknowledgement or failed cleanup, do not adopt/retry/drop
by guessed ownership. Preserve the failing run ID and have the approved local
operator reconcile only its exact database/role. No success is recorded until
the real test passes with zero failures/skips and exact cleanup is verified.
Neither local success nor this interface proves Azure APIs, Entra, private DNS,
TLS, deployment, collector lineage or the native data CLIENT boundaries.
