# Demo 01 construction source binding

The Demo 01 inspector remains **BLOCKED / NOT RUN / NOT CERTIFIED**. It does not
export a runnable adapter or perform browser, Java, query, sampling or reset
operations.

`tools\verification\adapters\demo01-source-binding.v2.json` is a prospective
current-source binding, anchored by its exact SHA-256 in `demo01-runtime.mjs`.
It accounts for the swarm's LOCAL REHEARSAL UI labels and portable-fixture
instructions. The other six pinned implementation inputs are unchanged.

The inspector's `authorFrozenSources` are historical metadata, not current
approval. `prospectiveSourceBinding.components` must match current component
bytes. Loaded runtime/browser-helper/privacy-scanner modules, the collector and
the original privacy policy must also match; caller JSON cannot refresh those
bindings. This is not a complete transitive-runtime or native qualification.
Old receipts and their hashes remain unchanged and confer no approval on the
new source epoch.

From the POC root, run the focused positive and isolated-copy drift controls:

```powershell
node --test --test-reporter=tap tests\verification\demo01-runtime.test.mjs
```

The standalone inspector's `--check` command returns exit code 2 with BLOCKED;
it is not a successful native demo. A future source-binding revision requires
fresh source checks and independent review, not a caller flag or edited JSON.
