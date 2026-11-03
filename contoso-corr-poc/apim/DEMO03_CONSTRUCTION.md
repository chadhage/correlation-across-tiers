# Demo 03 construction check

From the POC root:

```powershell
node .\tools\verification\adapters\demo03-runtime.mjs --check
node --test --test-reporter=tap .\tests\apim\demo03-construction.test.mjs
```

The inspector loads the actual carrier manifest, preserves the four required
sampled/absent/invalid/unsampled inputs, scans the current APIM policy/module
sources and checks the actual rewrite/RequestId forbidden-source fixtures.
Its immutable receipt binds its declared loaded sources, not a complete
transitive runtime closure. No input creates a
native observation, enrolled executor or generated root/span.
Source-check receipts contain the actual loaded snapshot, not mutable caller
data retained across an awaited disk check.

The expected CLI result is **BLOCKED**, exit **2**. Invalid arguments or source
checks exit **1**. There is deliberately no `createAdapter()` or `adapter`
export: `demos\03\Run.ps1` still fails `D_MISSING_ADAPTER`; this inspector is not
a replacement adapter and does not satisfy DEM-03.1's native acceptance.

Required next interfaces are approved authenticated Gateway trigger/stop/drain,
independent ingress/outbound wire and Gateway span observations, enrolled
original-RAW queries/privacy scanning, native bounded sampling control and
participant/emission observations, actual run-owned baseline/reset and durable
separate-process recovery. The shared DEM-00.1/Demo 01 native pattern and a
separately approved target/window are prerequisites. No cloud traffic, writes,
credentials or spending are enabled. All native assertions remain **NOT RUN**;
BootstrapValidate remains **NOT CERTIFIED**.
