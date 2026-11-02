# Security and privacy gates

**Preparation-only; NOT CERTIFIED.** No scanner grants permissions, deploys,
changes authentication context, or writes cloud secrets.

Run `Run-SecurityGates.ps1` from PowerShell. It executes the seeded Node tests
then scans the complete current repository, ignored configuration/evidence
(except generated dependencies/build outputs), and every unique Git blob
reachable from **all** refs. A historical secret is not excused by deletion.
Oversized/unreadable objects, malformed history batches and symlinks fail closed.
Verdicts contain paths/ordinals/codes and source blob hashes, never matched values.
Review JSON is scanned per scalar value to avoid treating unrelated prose as a
single SQL query; captured SQL literals/parameters and private identity remain
prohibited. An existing historical portable compiler is scanned, not silently
excluded because it was under `.cache`.

Known quoted credential fields (including environment-prefixed names) reject any
nonempty literal, including short, punctuated, whitespace-bearing and escaped
values. Empty values and whole environment-variable or validated Key Vault
references are not secret material; a reference concatenated with a literal is
not exempt, whether the addition is inside the quotes or a following expression.
Reference exemptions require assignment termination; operators, property/index
modifiers and comment-hidden continuations are conservatively rejected.
There is no fixture-directory or synthetic-value ignore rule.

Seeded source/params/demo/evidence fixtures are generated only beneath
`tests\security\fixtures-generated`, outside deployment paths, and removed by
tests. JWT/HMAC production-verifier tests never persist their material.

## GATE-03: references are not inline values

`repository.mjs` exports:

- `scanRepository({root,history:true,evidence:true})`
- `scanSecretText(text,{evidence})`
- `lintSecretReferences({appSettings,apimNamedValues,apimLoggers,storefrontFiles})`

Reference lint requires settings for all six canonical server roles, the
Key Vault-backed `contoso-appinsights-connection-string` named value and its
Application Insights logger alias. Plain values, missing roles/logger bindings,
and committed browser connection strings fail. It consumes an approved in-memory
configuration read; do not dump resolved configuration or credential values.
Passing repository/history checks alone does not establish deployed reference
resolution or least-privilege access.

## GATE-04: original raw data, then persistence

`telemetry.mjs` exports `scanRawTelemetry`, `scanGraphIntake`, `scanPrivacy`,
`lintTelemetryCapture`, `telemetryPolicy`, and the actual `policySha256`.

```javascript
scanRawTelemetry({
  tables: [{ name, columns: [{ name, type }], rows: rawColumnArrays }],
  receipt, // complete/paginationComplete/warnings/rowCount/tables/tableInventoryComplete
  canaryDisposition, // independently proved by the verifier, never invented here
  assessmentScope: 'all-telemetry'
});
```

Every original column/dynamic field is classified and scanned **in memory**.
Unknown fields, malformed/deep objects, JWTs, auth/cookies/bodies, personal
addresses/raw identity, SQL literals/parameters, Redis captures and identity
metric dimensions fail closed. Nonempty private client IP/precise geography,
claim bundles, exception detail/stack arrays and non-HMAC authenticated user IDs
are prohibited. Standard `IKey`/ARM metadata is classified in-memory only; it is
not proof of a telemetry publisher and is never returned in a verdict.
Only the approved versioned HMAC user pseudonym is allowed.

The global scan requires every declared table, the known App* table inventory,
sealed counts and proved canaries. Empty/filtered/incomplete capture cannot pass.
An unknown workspace table requires explicit privacy-owner classification,
not an ignore rule. No raw finding/value or per-value hash is persisted.

The narrowly separated `graph-intake` assessment scans exactly the sealed six
AppRequests/AppDependencies/AppPageViews/AppTraces/AppExceptions/AppEvents
tables. It can permit safe graph normalization while honestly retaining
`tableInventoryComplete:false`, but **never** establishes global GATE-04 safety,
exporter drop counts, source provenance or certification.
All verdicts explicitly have `sourceAcceptanceIsCertification:false`,
`globalTelemetrySafetyVerified:false` and `gateEligible:false`; R9 separately
adjudicates actual complete runtime evidence. `scannedAllColumns:true` is emitted
only when classification, shapes and scoped checks all succeeded.

`AppPageViews.Id` is classified as opaque display/context identity, not an actual
span. Only native request/dependency span IDs use the span-ID classification;
browser trace-context/carrier proof must be validated separately.

The flattened adapter accepts `{table,values}` rows with table schemas in
context; specify `assessmentScope:'graph-intake'` explicitly for that slice.
Original page hashes may be calculated in memory, but failed intake cannot
persist original pages. The approved normalizer must strip IKey, raw client
metadata, anonymous user/session fields, exception messages/stacks and every
non-whitelisted field before writing accepted native evidence.

`lintTelemetryCapture` requires APIM frontend/backend request/response bodies
at zero bytes, only an optional business-ID header, and disabled automatic
JDBC/Redis capture on the approved safe-manual path.

## GATE-10: identity is not causality or authorization

`identifiers.mjs` scans observed identifiers across rows for equality between
W3C IDs and business/broker/CloudEvent/APIM/Entra event IDs, including
hyphen-normalized UUID attempts. Business IDs must be UUIDv4/ULID and never metric
dimensions; retained Entra event IDs use only their separate security attributes.
The source guard rejects business-ID reads in known authorization methods and
direct metric-call dimensions. It is a focused regression guard, not a universal
Java/JavaScript semantic-analysis proof; actual JWT/authorization tests exercise
the real implementation independently.

Remaining acceptance: deployed Entra/app roles and ingress, approved HMAC
version/reader/retention policy, runtime Key Vault resolution, complete native
all-table telemetry and canaries/drop proof, and two accepted other-role reviews.

## Key Vault foundation and application staging

`infra\modules\security-keyvault.bicep` requires an explicit `hmacReference`:

- Foundation: `{ phase: 'foundation' }`, with no version or value field.
- Application: `{ phase: 'application', secretVersion: approvedExistingVersion }`.

Foundation may prepare the Standard/RBAC/purge-protected/deny-default vault but
emits an empty `hmacSecretUri`. Application requires the 32-character reference
member and emits its exact-version URI. `hmacReferenceConfigured` and
`hmacReferencePhase` describe input configuration, **not** actual secret
existence, generation approval, reader grants, reference resolution or readiness.
There is no secret-value resource/output or synthetic version default.

`hmac-reference-syntax.mjs` exports `validateHmacReferenceSyntax`: strict sealed
phase shape and nonzero lowercase 32-hex version syntax only. Even successful
validation reports `approvedExistingSecretVerified:false`; root application
preflight must independently require approved existing versions and bootstrap/
reader/logger binding evidence before any workload phase.

The dependency is foundation preparation, then separately approved SDK entropy
generation and cloud SET, then approved named-secret readers/logger bindings and
application reference resolution. SDK in-memory generation approval does not
authorize cloud SET. `security-secret-readers.bicep` remains read-only named-secret
scope preparation; omit its bindings in foundation until those secrets exist.
No staging check deploys, grants, retrieves or writes a secret.

## Shared original-native payload privacy port

`native-payload.mjs` exports `captureNativePayloads(input)` (also
`captureNativeApiPayloads` for the existing API input contract),
`createNativePayloadSession({publisherKeys, forbiddenValues})`,
`decodeNativePayload(bytes, encoding)`, `NATIVE_LIMITS`, and redacted error
classification. Decoding alone is **not** a privacy verdict: consumers must use
the capture/session port on the original raw bytes before inspecting or writing
their own narrower projection. It imports the existing `values.mjs` policy,
not another credential regex or telemetry provider.

`Scan-NativePayloads.mjs` accepts **stdin only**, with no arguments or file writes:

```javascript
{
  publisherKeys: [actualFixturePublisher], // 1..16 distinct UUIDv4 strings
  forbiddenValues: [exactCallerMarker],   // 0..64 markers, 8..16384 UTF-8 bytes
  payloads: [{ rawBase64: canonicalBase64, encoding: 'identity' /* or gzip */ }]
}
```

The CLI wrapper and each JSON/NDJSON native document use a strict bounded parser.
Duplicate **decoded** property names, including escaped-equivalent names, fail
before object projection. UTF-8 decoding is fatal. Raw and decompressed bodies
are at most 1 MiB each; an API/CLI batch has at most 16 payloads. One streaming
session has a fixed 128-POST limit, with at most 16 MiB total raw and decoded,
512 envelopes per payload / 8192 total, depth 32, keys 128 UTF-8 bytes, strings
4096 bytes, 8192 fields/values per envelope and bounded aggregate parsed nodes.
The stdin wrapper is at most 32 MiB with a 10-second input deadline. Limits are
fixed and exported; callers may impose tighter bounds, never bypass them.
The streaming count supports finite sampler/load flush cadence without relaxing
the byte/envelope limits; it is not measured proof that a future load fits.
Exceeding any bound still fails closed. Never rotate/reset sessions to evade a
single run's aggregate bound.

Every original field/value is scanned before removing publisher/machine/IP/user
tags. `iKey` must be a member of the exact fixture set at the envelope top level;
missing/foreign/nested placement fails, and publisher copies anywhere else fail.
Shared credential/personal/SQL/Redis rules, protected user identifiers and exact
caller markers apply to keys and values, including fields a later projection
would remove. Oversized or unsafe input fails the whole payload, not truncation,
masking, expected-name/ID backfill or a synthetic-fixture exception.
An explicit forbidden marker that is equal to, or a substring of, any allowed
publisher is a configuration conflict: `NATIVE_MARKER_PUBLISHER_CONFLICT` fails
before payload decode/projection. Known publisher membership never overrides an
explicit exact marker. Nonoverlapping fixture publishers remain valid.

Output preserves the existing `contoso.native-api-safe-capture.v1` schema and
`payloadReceipts` / `nativeEnvelopes` fields. It adds policy/module/CLI source
hashes, actual validator PID/Node version, raw-byte digests, decoded byte/envelope
counts and explicit non-authority flags. Native context fields remain original.
The projected envelopes are policy-scanned fixture data, **not** full-table
classification, publisher attestation, `SourceVerified`, role enrollment or
certification. Consumers must independently bind executable/source/raw hashes,
PID and actual counts; they still own span/route/provider/fidelity assertions.

Streaming callers use `session.ingest(rawBuffer, encoding)` and obtain only that
validated payload's projection and cumulative counters; `snapshot()` returns the
successful session. Any ingestion failure poisons the session and clears its
stored projection: later ingestion/snapshot fails with a static `NATIVE_*` code.
Buffer results in memory until all required inputs pass before persisting a
whole-run proof. The receive loop must bound bytes **while reading**, not only
after materializing an arbitrarily large Buffer.

CLI failure exits nonzero with empty stdout and one static `NATIVE_*` code on
stderr; raw values, publisher keys, marker values and exception causes are never
printed. Original `c42/00e/b380` identity and API/async/sampler epochs remain
unchanged. This new shared source requires fresh consumer import scopes,
original-source reviews and parent-granted actual retakes; CPU fixtures do not
retroactively qualify those runs.
