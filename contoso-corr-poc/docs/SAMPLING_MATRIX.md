# Contoso sampling matrix and bounded profiles

`config\sampling-profiles.v1.json` is executable profile input; Root/R4's version
lock supplies the approved parent guard. These controls are independent layers,
not a promise of coordinated 10% whole-trace sampling.

| Layer | Eligible controlled certification | Production proposal / restoration |
|---|---|---|
| Browser SDK 3.4.5 | 100%, `W3C_TRACE` / source-pinned 18, controlled finite window | 10%; restore runtime window/controls. Export percentage is not the wire sampled decision. |
| Workload Portal SSR | Server 100%, independent Node provider/window | 10%; supported stop/restart/reload required after lease; no second provider. Portal.Invoke is not human identity. |
| APIM all-APIs diagnostic | Fixed 100, W3C, allErrors, all four bodies0, frontendempty/backend Bid capturefalse | Restore actual scoped baseline; trace-policy emission/verbosity must also be bounded. No per-API override assumed. |
| Every Java/API/worker/replay process | Existing same-provider guard + native percentage100 and **RPS absent**, no suppressing overrides | Guard stays installed; root-approved measured percentage/rate restored. RPS takes precedence if non-null. |
| SDK-managed Functions host | Native supported full-eligible host configuration/observation independent of worker | Actual host configuration/duplicate ownership and restore acknowledgement required; Java controls do not configure host. |
| Backend/LAW/Appi | No downstream sampling/drop transforms; Analytics native schemas; existing approved caps/retention/privacy unchanged | Same identity-preserving backend; actual caps/reset/schema/read rights remain live To Do. |
| Collector/eval lanes | Absent | Absent; separately approved isolated eval only. |

The public API/source-supported external loader and provided SDK ABI are
different facts from **Contoso-owned sampler code proof**. User explicitly
approved the hash-pinned same-provider implementation, not a Microsoft vendor
GA/support guarantee. Preserve that VERIFY; do not invent a release date.

Actual current Java production baseline is **RPS5, percentage absent,
overrides[]**, from R4's frozen native configuration. The10% per-layer file
values are a proposal, not measured production approval or coordinated trace
sampling. Rollback restores actual owned baselines, not proposal defaults.
The user authorized guard **1.1.0**:
`DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS`.
The sole R4 version lock supplies its actual artifact/hash; a prior1.0.0/c3
receipt cannot qualify the new policy. R4 remains the implementation/version
owner; runtime control acknowledgements bind actual version/policy/hash.

## Mandatory distinct assertions

1. Valid authenticated `01`, all effective eligible-full controls: exact real
   expected spans/parents/links/logs, including Root's eight synchronous core
   boundaries. Settings or a zero denominator do not establish completeness.
2. Valid authenticated `00`, same declared participating paths: preserve trace
   identity and actual parent advancement; every outgoing sampled bit remains0.
   Java DROP/non-recording/absent export is explicit, not “100% fidelity.”
   No root restart/rejection solely because the bit is0, no omitted hop,
   no header surgery/agent fork/preview switch or scope waiver.

### Explicit linked-root decision

Historical1.0.0/c3 qualification observed ordinary-parent00 DROP/no export,
but replay/result/fan-in/batch no-parent roots sampled1 under consumer100.
That **failed** the literal every-required-outgoing00 assertion, despite
W3C permitting an independently created sampled trace. The original report
`workers\messaging-core\target\linked-root-sampling\qualification.json`
(`b81339a200aeafd21ee062dfdbcb29e20445abd2da36b26b326b11311d2c614e`)
is historical observed evidence, not overwritten or scope-waived.

User-approved1.1.0 extends only the existing same-provider guard. A valid
unsampled parent still DROPs. A no-parent root with a **nonempty, entirely
valid, entirely unsampled** link set also DROPs. Sampled/mixed link sets,
invalid-link/nonmatching sets and unlinked roots retain the delegate's
unchanged decision. No contributor becomes an arbitrary parent and no
carrier bit is repaired. This intentionally leaves all-unsampled linked-root
spans non-recording/unexported in **production as well as certification**;
it is not100% eligible-positive export proof. New real00/01/mixed runtime
retakes and separate ownership/full100 evidence remain required.

Actual1.1.0 byte-frozen candidate
`bb829be676bdc86e9a0657391764a419c7665c47542c2e53f64c37761f45193f`
was retaken by R5 in the closed local SDK/carrier/H2 harness: required00
ordinary/replay/result/fan-in/batch decisions all stayed unsampled, ordinary
PROCESS retained its actual source trace and export0, while actual01/MIX0/1
and unlinked controls retained delegate behavior. The new qualification at
`workers\messaging-core\target\linked-root-sampling\1.1.0\qualification.json`
has SHA
`a0eb3028e4a3ba7b648ed96dff23fc87628a1e161f5164d7f169ff1f24f282dd`.
Its1/1 assertion success is scoped local decision/export proof, not full00
export fidelity, Azure/AV23/global ownership or certification. R7 completed
and released its ordered1.1.0/BB829 loader/ACK/fixed0/100/RPS5 retake:
ordinary native counts2/0/2, actual MBean policy/version/hash and PID/JAR
provenance, with global provider/exporter counts still null. Its report
`extensions\parent-safe-sampler\target\agent-probe\1.1.0-bb829be676bd\result.json`
has SHA-256
`6bfa1d1e8904e795b22b161ca80cb08663ff0c63b5b7a607296e500c4a5d687e`.
This does not qualify the complete matrix, identity-header exclusion or
owned-library source/build lineage.

After the initial `approve_okhttp` scope, fresh protected JWKS/MI wire
absence was observed, but the raw unfiltered control disproved native
disable-switch honoring; that parent B report remains overall FAIL.
The subsequent approved `header_isolation_only` decision removes the
ineffective switch, retains identity CLIENT spans inside the application,
and requires public header isolation on every protected identity attempt.
Raw unfiltered native context is an explicit retained negative control,
not suppressed transport. Logical SDK sends and physical wire retries
remain separate counters.

This does not change parent/all-unsampled-link DROP, eligible-positive
sampling, the protected-path AV23 no-headers requirement or business
JDK/Netty/Reactor/default/injected/operator preservation. No sampled-bit
repair, identity sampling suppression or extra provider is authorized.
Historical `990a...` and parent17:06 FAIL reports remain unchanged; a new
granted current-mode build/native retake and independent reviews are
required before API_READY. Source/configuration or selected-binary103
evidence does not supply that acceptance or unused-module lineage.

W3C permits some tracer-originated flag changes; Contoso's stricter requirement
still fails on an observed upgrade. A Java guard cannot fix an APIM positive
egress that becomes0. Standard RECORD_ONLY is not itself evidence of export.

Controller JSON/file and native hash-pinned command adapters enforce bounded
window, actual roster, write-ahead baseline, owned-field CAS, native runtime
acknowledgements and independent watchdog. Local file readback is not native
runtime acknowledgement. A failed/missing restore prevents PASS. Never
rollback approved security/key rotation by overwriting an old full setting bag.

Native plans reserve the configured120-second drain interval before lease
expiry. The independent watchdog stops/drains only the approved run's synthetic
traffic through mandatory owner hooks, retains eligible-full settings while
draining, then restores at expiry. Complete safety/schema acknowledgement
checks apply to **production restore as well as activation**; no unsafe flags
or failed drain can yield PASS. Actual deployed drain remains To Do.

Native runtime controls use immutable startup leases and documented process
restart/document reload. Observer revisions, configuration and PID/page identity
come from actual initialized runtimes, not requested files. Unknown global
provider/exporter counts remain null: finite bootstrap control activation
cannot satisfy independent ownership/full-path gates. `Certify` requires
source-bound actual-roster and current gate verification; no CLI flag or hash
can enroll an observer or create a certificate.
