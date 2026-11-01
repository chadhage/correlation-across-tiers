# Contoso telemetry module

`telemetry.bicep` uses stable component `2020-02-02`, LAW `2023-09-01`,
budget `2023-11-01`, scheduled-query `2023-12-01`, workbook `2022-04-01`
schemas. Compilation is not deployment, region/support validation or certification.

Inputs: R1 `names.law` / `names.appi`, `location=centralus`, tags, approved
per-workspace/table retention, daily cap, telemetry-only budget/start date,
R8/root action-group IDs, optional generated Notebook/1.0 JSON string.
Outputs are resource/workspace/application identifiers and configuration values.
**No connection string, instrumentation key, credential, secret value or role
assignment is emitted or created.** R8's approved in-memory bootstrap reads
the actual component configuration into Key Vault.

One shared workspace-based Application Insights component keeps local browser
ingestion enabled. Resource context is one component boundary, not a security
boundary per role. Shared browser ingestion is publicly injectable; authenticated
Logs reads are not producer authentication.

The LAW cap limits the effective shared ingestion cap even when the component
cap is higher. Actual AI/LAW cap/reset behavior, table-level retention overrides,
Analytics plans, `_LogOperation` schema, query validation/receivers and quota
remain **To Do** until deployed observation. Caps overshoot and can blind
telemetry. The rolling-24-hour Usage rule is delayed/conservative volume
visibility, **not exact cap-reset accounting or a real-time spending switch**.
Budget notifications neither stop workloads nor replace approval.

Empty notification IDs disable notifications/rules and explicitly leave
governance unresolved; never call that an operational alert route. All six App*
tables must be discovered/validated after real ingestion; this module does not
invent or pre-create native system tables. Workbook content is generated from
R1's single boundary map, not a second topology copy.
