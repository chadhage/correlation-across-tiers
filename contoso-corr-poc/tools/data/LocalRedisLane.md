# DAT-02.1 — opt-in real local Redis cache-adapter lane

**LOCAL CONSTRUCTION ONLY — REAL REDIS EXECUTION NOT EXECUTED.**
No approved local Redis target was supplied. This host has no `redis-server`,
`redis-cli` or Docker executable. No port probe, connection, installation,
provisioning or secret retrieval was attempted. Actual real-store execution and
its independent cleanup review remain **To Do**, never replaced by a RESP peer.

## Configuration preflight is not a connection test

```powershell
node --test --test-reporter=tap .\tools\data\local-redis-preflight.test.mjs
node .\tools\data\local-redis-preflight.mjs
```

Default CLI inputs return exit 2 / `BLOCKED`. Valid explicit inputs return
`INPUTS_VALID_NOT_CONNECTED`, `LOCAL_CONFIGURATION_ONLY` and
`realStoreExecuted: false`. This independently tested interface never opens a
socket or starts Java/Redis. It prints no username, password, URL or cache value.

## Explicit real lane

`LocalRedisLane` is deliberately outside default Surefire `*Test` discovery.
Select it explicitly only against an independently approved existing Redis
**7 or newer**, standalone numeric-loopback instance. The production cache
adapter currently emits fixed `server.port=10000`, so this local lane requires
the actual port **10000** rather than emitting false endpoint metadata. Do not
point a loopback proxy/tunnel at a cloud store. This is not a Managed Redis
EnterpriseCluster, TLS, Entra, token-refresh or per-app identity qualification.

```powershell
$env:CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS = 'run-owned-only'
$env:CONTOSO_LOCAL_REDIS_HOST = '127.0.0.1'
$env:CONTOSO_LOCAL_REDIS_PORT = '10000'
$env:CONTOSO_LOCAL_REDIS_RUN_ID = [Guid]::NewGuid().ToString()
# Optional CONTOSO_LOCAL_REDIS_USERNAME/PASSWORD are supplied locally.
# Never put credentials in the command, URL, source, evidence or log.
node .\tools\data\local-redis-preflight.mjs

# R4 alone holds the Maven/build-output lease during the active swarm.
mvn -o -B -ntp -pl services\inventory-data -am test '-Dtest=LocalRedisLane' '-Dsurefire.failIfNoSpecifiedTests=false'
```

`LocalRedisLaneContractTest` is a separate default-safe parser/URI/name test
which makes no connection. It is not a real-store test.

The real lane must verify `INFO server` identifies actual Redis and a supported
standalone version, then inject real Lettuce connections into the unchanged
production `LettuceInventoryCache`. GET miss/population/hit, SETEX TTL, DEL,
capture/PXAT restoration without TTL renewal, canonical-value rejection and
sanitized corrupt-value errors are checked on exact unique run-owned keys.
This tests the real cache adapter, not H2, a RESP peer or invented server rows.

Only three keys under `contoso:corr:poc:inventory:v1:LOCAL_<runUUID>_...` are
eligible. Each is first claimed with NX plus a finite TTL; existing keys are
never adopted, overwritten or deleted. One separately claimed witness must
remain unchanged by adapter operations. Witness coverage is only that declared
key, not a scan of unrelated Redis state. Keep an external exclusive run lease;
an in-process test or a string approval is not authentication/authorization.

Cleanup watches only successfully claimed keys, checks the live lease/value
ledger, and transactionally deletes only those exact keys. A changed value,
discarded transaction, unknown acknowledgement or failed cleanup is not
automatically replayed or certified. Retain the run ID for the approved local
operator to reconcile exact keys; the bounded seeded TTLs limit abandoned state.
No KEYS/SCAN, script/EVAL, global flush, CONFIG, ACL or generic raw-command
surface is introduced. Client resources are bounded and closed; no store
process is started or stopped by this lane.
