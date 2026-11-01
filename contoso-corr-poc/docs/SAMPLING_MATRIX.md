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

## Mandatory distinct assertions

1. Valid authenticated `01`, all effective eligible-full controls: exact real
   expected spans/parents/links/logs, including Root's eight synchronous core
   boundaries. Settings or a zero denominator do not establish completeness.
2. Valid authenticated `00`, same declared participating paths: preserve trace
   identity and actual parent advancement; every outgoing sampled bit remains0.
   Java DROP/non-recording/absent export is explicit, not “100% fidelity.”
   No root restart/rejection solely because the bit is0, no omitted hop,
   no header surgery/agent fork/preview switch or scope waiver.

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
