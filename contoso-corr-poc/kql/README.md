# Contoso KQL procedures

Render the three workspace or three separate legacy templates with
`node tools\observability\kql.mjs <procedure> <parameters.json> <output.kql>`.
The renderer resolves every binding, validates inputs, emits runnable KQL and
records query/root-map hashes. No query is executed automatically.

Required parameters: schema (`workspace` or `legacy`), approved Application
Insights ARM scope, UTC half-open event interval; captured nonzero trace ID for
trace reconstruction or trusted UUIDv4 invocation ID for business lookup.
Optional bounded lookback, ingestion grace/as-of time, trusted actual
trace/span→boundary assignments and reference evidence are validated.
Assignments classify **observed** IDs; they never create missing spans.

The single topology source is `contracts\expected-boundary-map.v1.json`, owned
by R1. The renderer derives all map/edge/root bindings from it. No second map
is persisted here. Correlation-core does not automatically emit a boundary-ID
attribute: R9 must bind actual native operation/carrier evidence to root-map
selectors. Empty assignments cannot certify complete coverage.

Direct 16-hex IDs are checked unchanged. Composite serialization requires an
explicit source/SDK evidence hash; arbitrary GUID conversion is rejected.
Logs use associated span identity, views are not backend spans. Native Java
`_MS.links` is a string of `operation_Id`/`id` pairs; missing link attributes,
flags, tracestate and drop counters remain unknown. Strict parents join within
one trace; link targets use their own trace IDs. Reconstruction selects one
outgoing linked-operation hop; the R9 harness resolves the bounded frontier.

Business co-membership is not direct invocation ownership. A missing parent
or link remains a candidate with root-map/proof/timing context; sampled/delayed
labels do not waive required positive coverage. R9 separately checks entire
missing boundaries, wrong existing parents, duplicates and contributor counts.
Timestamp+duration requires source-confirmed start-time semantics.

Separate `conditionalRoots` are candidate policies, not deliberate-root
exemptions. Exact policy/disposition, actual null parent, role and source-bound
runtime/carrier evidence are required. Default queries retain these as
`conditional-root-unverified`; generic remote-reference labels, state-only
errors or business UUID changes cannot waive them. Caller proof JSON is not
native authority. The private R9 graph-session binding interface supplies
adjudicated inputs only after genuine source/native intake.
For in-process rendering, pass `verifiedGraphCapability`, its original
`verifiedGraphRows`, and `verificationMode`. The renderer uses R9's sealed
getter; copies, fixtures/LocalValidate and caller JSON cannot supply native
conditional exemptions. Runtime/carrier observer enrollment is currently
unavailable, so these roots remain unverified rather than being filled with
expected map values.

All six tables, field types/native ID mappings, query compilation/execution,
complete source permissions/partial-result handling and actual delays remain
**To Do** on deployed LAW. Local fixtures validate checker behavior, not Azure
rows. Filtered trace/business procedures are **not** the all-table privacy scan.
R8 scans original native intake before safe snapshots/typed exports; never
persist connection configuration or raw unsafe response bags.
