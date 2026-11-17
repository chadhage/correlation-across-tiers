# Contoso Demo 01: Synchronous golden path

## Start here

- [Getting started, sample code, Azure/local deployment, testing, debugging and reuse](GETTING_STARTED.md)
- [Step-by-step adoption from stock ARM/Application Insights boilerplate](BOILERPLATE_INTEGRATION.md)
- [Completion assessment, actual validation and atomic remaining tasks](COMPLETION.md)

The bounded local browser/two-JVM rehearsal is runnable:

```powershell
# From contoso-corr-poc, with the declared local tools/dependencies prepared:
.\tools\java\Start-LocalPair.ps1 -OutputDirectory ".cache\golden-path\run-$([Guid]::NewGuid())" -RunBrowser
```

It uses real application handlers and agent/browser exports with H2/RESP and
synthetic identities. It is **not APIM, real-store, Entra or Azure acceptance**.
The existing native Run/Reset adapter remains blocked; the local launcher does
not bypass it. NOT CERTIFIED.

## Purpose
Observe Storefront, real Gateway request/backend dependency, Orders, Inventory and safe JDBC/Redis CLIENT spans. Brief sections: 17, 19, 24.

## Pre-state
Use an approved native adapter, record actual baseline hashes and a finite sampling lease. VERIFY: approved runtime/control/capture interfaces and external owner evidence; no cloud approval is implied.

## Run
From the POC root: `powershell -File .\demos\01\Run.ps1 --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash> --mode LocalValidate`.
Use BootstrapValidate only with explicit approved native target/traffic. It remains NOT CERTIFIED. Missing adapters or native evidence fail, never mock PASS.

## Live show
Filter Application Map and Transaction Diagnostics by the **observed** business/trace IDs; show the native rows and exact boundary edges. See docs\DEMO_RUNBOOK.md. Uncaptured screenshots remain NOT CAPTURED.

## Evidence and assertion
The single root expected-boundary map is expectation only. The runner calls native A/B/C, coverage/privacy/canary and sync checks, with Coverage, Trace identity, Span identity, Backend usability §24 mappings. Outputs are under evidence\demo-01\<UTC-run-id>. Original sensitive metadata is never persisted.

## Reset
The runner always stops/drains and resets its own run after a captured baseline. Repeat with `powershell -File .\demos\01\Reset.ps1 --pack <relative-evidence-pack> --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash>`. It must prove baseline/flags/seed/owned messages/sampling restoration. It never purges shared or unowned state.
