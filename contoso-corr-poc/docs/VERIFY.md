# Scoped verification obligations

## INF-05.2: untyped data resource APIs

**Partially verified, local compilation only.** Bicep CLI 0.48.1 reports six
BCP081 diagnostics for the frozen data modules. None is suppressed. A successful
compile cannot validate these resource properties, prove API/SKU/region support,
or demonstrate deployment or connectivity. No older API is substituted.

The exact diagnostic text and regression gate are defined by
[`data-api-warning-contract.v1.json`](../services/inventory-data/docs/data-api-warning-contract.v1.json)
and [`data-api-warnings.mjs`](../services/inventory-data/tools/data-api-warnings.mjs).
Each row below references the existing `id` in
[`verification-register.v1.json`](../config/verification-register.v1.json).
Those VERIFY obligations remain open:

| VERIFY row ID | Untyped resource API |
|---|---|
| `infra\modules\data-postgres.bicep#resource:server` | `Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01` |
| `infra\modules\data-postgres.bicep#resource:administrator` | `Microsoft.DBforPostgreSQL/flexibleServers/administrators@2026-10-01` |
| `infra\modules\data-postgres.bicep#resource:database` | `Microsoft.DBforPostgreSQL/flexibleServers/databases@2026-10-01` |
| `infra\modules\data-managed-redis.bicep#resource:cluster` | `Microsoft.Cache/redisEnterprise@2026-09-01` |
| `infra\modules\data-managed-redis.bicep#resource:database` | `Microsoft.Cache/redisEnterprise/databases@2026-09-01` |
| `infra\modules\data-managed-redis.bicep#resource:access` | `Microsoft.Cache/redisEnterprise/databases/accessPolicyAssignments@2026-09-01` |

```powershell
node --test --test-reporter=tap .\services\inventory-data\tools\data-api-warnings.test.mjs
pwsh -NoProfile -File .\services\inventory-data\tools\Test-DataModules.ps1 -BicepPath <existing-bicep-0.48.1>
```

The PowerShell check compiles only the two data modules with `--no-restore`,
retains actual SARIF diagnostics in a unique workspace output directory, and
rejects missing/extra/changed warnings or compiler drift. The Node checker tests
positive and seeded failure cases; generated test diagnostics are not an actual
compiler run. Provider-property validation requires a separately approved Azure
deployment and bounded connectivity/identity tests. This gate performs none.
