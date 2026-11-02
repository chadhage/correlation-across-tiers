# Contoso Correlation workbook

Generate/check the Notebook/1.0 artifact using
`node tools\observability\workbook.mjs --write|--check`.
The only authoritative boundary map is R1's
`contracts\expected-boundary-map.v1.json`; the artifact records its byte hash.
It is a derived renderer output, not a second editable map.

`telemetry.bicep` supports serialized JSON through its optional
`workbookSerializedData` input. Current Rootv3 `infra\main.bicep` does not pass
that input, so its empty default does not create a workbook resource. Root
wiring is a separate acting-R1 preparation facet requiring a new granted source
change; local generation/check is not Azure deployment or import.
Resource/time/text parameters contain no tenant,
resource ID, connection string or authorization secret. String expansion is
escaped; text IDs are regex-constrained. The default triage input contains no
invented observed assignments/reference proofs. Bind signed R9 run inputs
through the query renderer before final assertions.

The conditional-root ledger displays exact source policies/dispositions with
native evidence **UNVERIFIED** by default. No viewer toggle, root-map label or
missing-parent row supplies a native trust-root receipt. Regenerate and run
`--check` after root-map changes; an in-memory workbook test alone does not
establish that the committed artifact matches the current map.

Volume is physical billed bytes, never `ItemCount` weighted. Usage is hourly,
ingestion timestamps approximate; cap/budget controls are not real-time spend
guarantees. Performance/cost use actual measurements and approved R1 inputs.
All-table privacy/source validation precedes safe evidence persistence.

Actual Azure import/render, live target metrics, Application Map/Transaction
Diagnostics screenshots and complete known trace/link results remain **To Do**.
No blank slots, stock screenshots or fixture rows satisfy those clauses.
