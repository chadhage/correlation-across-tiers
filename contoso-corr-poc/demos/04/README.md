# Contoso Demo 04: Trusted business invocation identity

## Purpose
Replace untrusted identity, accept a trusted valid value and prove exact business lookup over HTTP and Service Bus. Brief sections: 11, 18.

## Pre-state
Use an approved native adapter, record actual baseline hashes and a finite sampling lease. VERIFY: approved runtime/control/capture interfaces and external owner evidence; no cloud approval is implied.

## Run
From the POC root: `powershell -File .\demos\04\Run.ps1 --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash> --mode LocalValidate`.
Use BootstrapValidate only with explicit approved native target/traffic. It remains NOT CERTIFIED. Missing adapters or native evidence fail, never mock PASS.

## Live show
Filter Application Map and Transaction Diagnostics by the **observed** business/trace IDs; show the native rows and exact boundary edges. See docs\DEMO_RUNBOOK.md. Uncaptured screenshots remain NOT CAPTURED.

## Evidence and assertion
The single root expected-boundary map is expectation only. The runner calls native A/B/C, coverage/privacy/canary and business checks, with Durable lookup, No falsification §24 mappings. Outputs are under evidence\demo-04\<UTC-run-id>. Original sensitive metadata is never persisted.

## Reset
The runner always stops/drains and resets its own run after a captured baseline. Repeat with `powershell -File .\demos\04\Reset.ps1 --pack <relative-evidence-pack> --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash>`. It must prove baseline/flags/seed/owned messages/sampling restoration. It never purges shared or unowned state.
