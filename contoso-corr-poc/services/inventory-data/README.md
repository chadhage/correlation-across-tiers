# Contoso data runtime

Plain JAR `com.contoso:inventory-data:1.0.0`; it is not an executable Inventory app.

## Shared ownership and APIs

R4 owns the root/core POM, HTTP shells and provider. R6 owns
`com.contoso.correlation.data` interfaces/JDK+OTel-API helpers, this runtime and
V001. R5 owns workflow SQL/transactions and V002. Neither store initializes an
OpenTelemetry SDK or another exporter.

```java
PgConnectionFactory pg = EntraPgConnectionFactory.fromEnvironment("contoso-orders-api");
boolean reachable = PgOperations.execute(pg, PgOperation.SELECT, operationContext, 1, connection -> {
    try (var query = connection.prepareStatement("SELECT 1"); var rows = query.executeQuery()) {
        return rows.next();
    }
});
InventoryDataAdapter inventory = PgRedisInventoryDataAdapter.fromEnvironment();
```

Runtime factories are in `com.contoso.inventory.data`; interfaces, `OperationContext`,
`PgOperation`, `SqlWork`, `PgOperations` and safe `DataAccessException` are in
`com.contoso.correlation.data`. The factory is AutoCloseable with a default close
for test lambdas; real factories close pools/executors. One instance is reused per
JVM/database/identity profile. Connections/results/streams must not escape callbacks.

The callback owns transaction semantics. Cleanup rolls back uncommitted state and
returns/discards the connection. No implicit commit or hidden retry. Explicit safe
retries invoke the helper again; they do not sleep or contact brokers while leased.

## Environment

| Key | Value/requirement |
|---|---|
| `CONTOSO_PG_HOST` | Original `contoso-*.postgres.database.azure.com` hostname resolving privately |
| `CONTOSO_PG_DATABASE` | `contoso_orders`; approved bootstrap may use `postgres` for Entra role mapping |
| `CONTOSO_PG_USERNAME` | OID-bound PostgreSQL role, never an administrator for runtime stores |
| `CONTOSO_PG_RESOURCE_ID` | Approved POC server ARM ID; must match hostname and bound dataset marker |
| `CONTOSO_REDIS_HOST` | `contoso-*.redis.azure.net` Managed Redis endpoint, not legacy Cache for Redis |
| `CONTOSO_REDIS_PRINCIPAL_ID` | Managed identity/service-principal object ID assigned to GA default policy |
| `AZURE_CLIENT_ID` | Optional user-assigned managed identity client ID; absent selects system-assigned |
| `APPLICATIONINSIGHTS_ROLE_NAME` | Fixed Contoso service identity; factory overload also accepts it |
| `APPLICATIONINSIGHTS_INSTRUMENTATION_JDBC_ENABLED` | Explicit `false` for manual primary lane |
| `APPLICATIONINSIGHTS_INSTRUMENTATION_REDIS_ENABLED` | Explicit `false` for manual primary lane |

Conflicting native JDBC/Lettuce/Jedis enable flags and driver/protocol/auth DEBUG
logging fail startup. Provider/config/sampling attachment stays R4-owned.

## Authentication, bounds and privacy

PostgreSQL uses only the managed identity audience
`https://ossrdbms-aad.database.windows.net/.default`. Internal single-flight refresh
supplies valid tokens to **new physical connections**, not a permanent Hikari
password. Identity/pool preparation occurs before the SQL CLIENT scope. Tokens
are never URLs, attributes, exception causes or log fields.

Hikari pool maximum 2/profile, idle 0; pool wait 1 s, connect 3 s, socket 5 s,
cancel 1 s. Caller deadline bounds acquisition; shared SQL watchdog/statement
timeouts bound execution. Expired/aborted connections do not return as reusable
leases. pgJDBC uses `verify-full` and the JDK trust store via
`org.postgresql.ssl.DefaultJavaSSLFactory`, not an unvalidated SSL factory or a
user-profile certificate file.

Managed Redis uses Lettuce + stable AuthX Entra, TLS hostname/certificate verification,
one reusable connection with bounded queues/IO threads, `ON_NEW_CREDENTIALS`
reauthentication, refresh ratio 0.25/lower interval 1 s and bounded token retries.
The 60-second cache is disposable. No command replay after unknown ACK, raw-command
SPI, scripts, global flush, global key enumeration, key hash or key metric label.
Actual private-service renewal/expiry behavior remains a live acceptance test.

Each logical SQL/Redis operation ends its CLIENT span after result completion/error
and cleanup. Stable names and bounded verbs/outcomes only. No statements, parameters,
connection strings/users, keys/values/scripts/arguments or raw exceptions.
Azure mapper 1.7.0 can put the **fixed operation verb** in `AppDependencies.Data`;
empty-only assertions are incorrect. CLIENT telemetry is not PostgreSQL/Redis
SERVER telemetry. Links belong on their application PROCESS/replay boundary, not
copied onto SQL children.

Valid local sampled-0 parents are not independently sampled by this helper.
The Java/APIM **remote** sampled-0 no-resurrection gate remains R4/R7/R9-owned.
Unsampled protocol/suppression evidence is separate from eligible sampled-1
full-span coverage.

## Inventory and bootstrap

V001: `src/main/resources/db/migration/V001__inventory.sql`.
Five synthetic SKUs `CONTOSO-001` … `CONTOSO-005`, quantity 20, revision 1.
Cache miss: GET → PostgreSQL SELECT → SET; hit: GET only.
Reservation is PostgreSQL-authoritative with unique `(order_id, sku)`, stock lock,
quantity-conflict rejection and idempotent release. Cache failures cannot oversell.

No migration runs in a factory or application startup. R1's separately authorized
runner applies V001 then R5's V002. `InventorySchemaHooks` exposes:

* `install(adminFactory, Permit, OperationContext)` — V001 and target binding.
* `registerPrincipal(postgresAdminFactory, Permit, Principal, OperationContext)` —
  OID-bound nonadmin principal mapping in database `postgres`.
* `grantInventory(adminFactory, Permit, Principal, OperationContext)` — minimal
  Inventory CONNECT/USAGE/table grants; no runtime DROP/CREATE/TRUNCATE/DELETE.
* `resetOwnedRows(adminFactory, ownedCache, Permit, OperationContext)` — approved
  resource/database/marker checks, known synthetic rows only and five known cache
  keys. Unrelated/non-synthetic records remain untouched. Reset returns stock20,
  revision1 and no owned reservations.

The permit is a target/execution guard, **not authentication**. Bootstrap requires
the independently authorized administrative identity; these methods are not normal
web routes. Drain demo mutation traffic before reset. Existing owned rows are locked
with the dataset marker; a reset never broadens to other schemas or key namespaces.

## Validation and remaining live acceptance

Run the existing Maven test runner on this module and core with the portable JDK25 /
Maven3.10 tools; keep Maven/JVM scratch and repository paths in the workspace.
Set `CONTOSO_AGENT_JAR` to the approved pinned agent to run local qualification.

Tests use real JDBC/Hikari over H2, a bounded local RESP peer with real Lettuce,
fake identity tokens, DTO/error/deadline checks and a **real single-agent** child
with loopback NDJSON ingestion receipts. Positive data graph, absent-manual-span
negative control, raw sentinel/privacy scans, local sampled-0 suppression, native
links/parentage and bounded 256-MiB heap are verified locally. H2/RESP/loopback are
not Azure service certification or evidence of PostgreSQL-native spans.

`tools/Test-DataModules.ps1 -BicepPath <existing-cli>` only compiles/checks the two
owned modules. The compiler lacks types for the latest documented GA data APIs
(BCP081); no older API was substituted.

**To Do (live):** approved capacity/cost/provisioning; provider-property validation;
private DNS/routes/TLS and SCM deployment reachability; actual PostgreSQL patch,
principal grants and transaction behavior; Managed Redis Entra refresh/AUTH/idle
reconnect; full HTTP/message remote-00 policy and all-service receipt/KQL equality;
shared P1v3 aggregate heap/native/CPU/connection-budget load and shutdown tests.
No Azure/RBAC/directory/provisioning write was performed by R6.

Authoritative details: [Java agent configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/app/java-standalone-config),
[pgJDBC TLS/timeouts](https://jdbc.postgresql.org/documentation/use/),
[PostgreSQL Entra roles](https://learn.microsoft.com/en-us/azure/postgresql/security/security-manage-entra-users),
[Redis Entra refresh/AUTH](https://learn.microsoft.com/en-us/azure/redis/entra-for-authentication),
[Lettuce Entra lifecycle](https://redis.io/docs/latest/develop/clients/lettuce/amr/),
and the [release-bound Azure mapper](https://repo.maven.apache.org/maven2/com/azure/azure-monitor-opentelemetry-autoconfigure/1.7.0/azure-monitor-opentelemetry-autoconfigure-1.7.0-sources.jar).
