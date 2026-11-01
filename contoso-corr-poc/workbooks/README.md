# Contoso Correlation workbook

Generate/check the Notebook/1.0 artifact using
`node tools\observability\workbook.mjs --write|--check`.
The only authoritative boundary map is R1's
`contracts\expected-boundary-map.v1.json`; the artifact records its byte hash.
It is a derived renderer output, not a second editable map.

Root passes the serialized JSON to `telemetry.bicep`'s
`workbookSerializedData`. Resource/time/text parameters contain no tenant,
resource ID, connection string or authorization secret. String expansion is
escaped; text IDs are regex-constrained. The default triage input contains no
invented observed assignments/reference proofs. Bind signed R9 run inputs
through the query renderer before final assertions.

Volume is physical billed bytes, never `ItemCount` weighted. Usage is hourly,
ingestion timestamps approximate; cap/budget controls are not real-time spend
guarantees. Performance/cost use actual measurements and approved R1 inputs.
All-table privacy/source validation precedes safe evidence persistence.

Actual Azure import/render, live target metrics, Application Map/Transaction
Diagnostics screenshots and complete known trace/link results remain **To Do**.
No blank slots, stock screenshots or fixture rows satisfy those clauses.
