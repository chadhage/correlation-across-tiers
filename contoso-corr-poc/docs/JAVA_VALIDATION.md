# Java implementation and local validation

## Scope and ownership

R4 supplies the root Maven/lock inventory, API-only correlation helpers/shared
workflow ports, Orders API, Inventory HTTP shell, compute Bicep and single-agent
packaging/guards. R6 exclusively supplies the core data subpackage and
`inventory-data`; R8 supplies verified identity/HMAC in `security-core`; R5
supplies `messaging-core` and workers. Completion dependencies and live
acceptance are unchanged. No card was marked Done.

The approved physical naming map is an input to compute. The module creates
one P1v3 Dedicated plan, two Java API apps, three Java Functions and one Node
Storefront/Portal app. Heaps are 384 MiB/API, 256 MiB/worker and 256 MiB/Node;
this is a bounded candidate, not a capacity/SLO certificate.

The Node startup `node dist/bootstrap.js` assumes the deployment artifact root
is R2's `web\portal-ssr` leaf. From the monorepo root the corresponding local
command is `node web\portal-ssr\dist\bootstrap.js`. Root deployment packaging
must preserve that leaf-root contract; the physical Node app still cohosts
both Storefront and Portal. R2's completed local tests do not certify the
deployed Node 24 image, Portal MI or the integrated backend.
Build Storefront first, then Portal. R2's verified cohost packaging copies the
prebuilt SPA into leaf `dist\storefront` alongside `dist\bootstrap.js` and
`dist\public`; the deployed Portal does not depend on an external sibling
directory. Compute's leaf-root startup remains `node dist/bootstrap.js`.

## Reproduce local checks

Portable tools are checksum-verified and installed only under the session's
`files\tools\r4`, never globally. A missing-tool validation was executed before
installation. Re-source the environment in every new PowerShell process:

```powershell
. .\tools\java\Use-Portable.ps1
.\tools\java\Gate-02.ps1
.\tools\java\Gate-05.ps1
node --test .\tests\java\gates.test.mjs
.\tools\java\Validate-Compute.ps1
.\tools\java\Freeze-Versions.ps1
```

Agent 3.7.10 SHA-256:
`93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec`.
The single agent owns the provider; applications use OTel API/context 1.65.0,
not an SDK, classic AI client, tracing bridge or additional exporter.
The user subsequently approved **one compiler-only PROVIDED SDK API
exception** for `extensions\parent-safe-sampler`,
`com.contoso:contoso-parent-safe-sampler:1.0.0`, ABI 1.65.0. Root Enforcer
defaults still ban SDKs; only that child may declare the exact trace/common/
AutoConfigure-SPI PROVIDED exceptions. GATE-02 scans its sources, all declared
scopes and built JAR; it does not exclude the extension directory. No SDK or
dependency JAR may be bundled. Runtime loading requires the frozen JAR
hash, SPI provider and actual loader/classloader evidence. The qualified JAR
SHA-256 is `08592fa4f8fea7b7d259efd2ea38753d9ddc0e9abed05c2e42b62d7bbf2218ce`;
its only loader argument is `-Dotel.javaagent.extensions=<one exact JAR>`.
Contoso-owned approval is **not** a Microsoft vendor GA/support assertion.

## Observed results and their limits

- **22 core tests passed**, including UUID/trust/duplicate inputs, scope/MDC
  restoration, configuration/extra-provider guards, graph/canary sensitivity,
  real agent-native spans/links/shutdown receipt and repeated-process IDs.
- A real Boot 4.1.2/Tomcat 11.0.27 server and JDK HTTP client under Java
  25.0.5+8/agent 3.7.10 emitted native request/dependency records with the
  exact client→server parent edge. A 200/startup log alone is not accepted.
- **10 HTTP construction tests passed**, covering owned source compilation,
  typed routing/bounds, real loopback HTTP business-header forwarding and
  honest staged/not-ready responses. These are explicitly **not integrated
  runtime acceptance**.
- **7 Node guard tests passed**, including never-deployed second-SDK/provider
  fixtures, source/lock consistency and single-agent startup.
  PROVIDED SDKs in other modules, wrong extension ABI/scope and provider
  construction inside the extension are rejected rather than excluded.
- **21 real R6 data-library tests passed** under the shared portable toolchain:
  JDBC/Hikari/H2, Lettuce/local RESP, token/pool/schema/idempotency and native
  single-agent data emission/sentinel checks. The actual library is installed
  in the shared Maven repository; no data API headers remain in construction.
  This is not Azure PostgreSQL/Managed Redis qualification or full remote-`00`
  certification.
- Compute compiled cleanly with portable Bicep 0.48.1; no Azure validation or
  deployment was invoked.
- R7's real pinned-agent/Java-25 parent-safe probe passed on/off/on native
  counts **[2, 0, 2]**, preserved valid `00`, delegated eligible behavior and
  retained fresh IDs after restart. The extension loaded once per process in
  `ExtensionClassLoader`, sharing the passed Microsoft `DelegatingSampler`
  from `AgentClassLoader`. This is a Contoso-owned local qualification, not
  Microsoft vendor GA/support or Azure certification.

The local ingestion receiver parses **all native NDJSON envelopes**, not only
the first JSON object. An initial parser error yielded zero counted spans;
the oracle failed and was corrected. A duplicate HTTP fixture bean and a
blocked child-output pipe also failed qualification and were fixed. These
failures are not converted into a service-startup pass.

The construction fixture is outside the reactor and uses the real R6 data
library plus test-source-only API headers for unpublished R8/R5 libraries. Those header factories throw
`CONSTRUCTION_ONLY`, cannot authenticate or produce business effects, and
must **never** be installed, deployed or added to an app classpath.

Actual standalone Orders dependency resolution was attempted and failed
while `security-core`, `messaging-core` and the real `inventory-data` artifact
were not available in the shared Maven repository. The R6 data artifact is
now verified/installed; the actual R8/R5 modules remain required. Their third-party
dependencies are not fabricated or downgraded. After those real modules are
published, run the real reactor build and packaging:

```powershell
mvn -B -pl services/orders-api,services/inventory-api -am verify
.\tools\java\Package-Service.ps1 -ModulePath services\orders-api `
  -JarName orders-api-1.0.0.jar -ServiceName contoso-orders-api
.\tools\java\Package-Service.ps1 -ModulePath services\inventory-api `
  -JarName inventory-api-1.0.0.jar -ServiceName contoso-inventory-api
```

## Runtime contract

R2's code-review findings `R2-R4-01/02/03` were remediated locally. Production
guards no longer have a `contoso.requireAgent=false` bypass. Both the startup
script and production main reject implicit `JDK_JAVA_OPTIONS`/`_JAVA_OPTIONS`.
Resource admission checks the explicit application loader, context loader,
core loader and system loader; packaged `BOOT-INF` and recursively nested
JARs are inspected for forbidden SDK/extension/runtime dependencies.
Regression fixtures prove that a system-loader-only check would miss the
context resource and that an innocuously named nested SDK JAR is rejected.
The reviewed APIM `2024-05-01` family is in the regenerated version lock.
These code fixes do not change the read-only review snapshot or certify live
launch/configuration behavior.

R6's subsequent bounds notification is also remediated: Inventory lookup
checks expiry before token acquisition, gives the asynchronous credential
operation the remaining budget, and bounds the full token→headers→body→parse/
close lifecycle with one absolute/monotonic deadline and a bounded executor.
Timeout cancels the request and closes an exposed body without blocking the
caller beyond the deadline. Expired-before-token, delayed-token and actual
headers-then-stalled-body regressions pass; they are local controls, not live
Entra/Inventory proof. Current native `otel.instrumentation` JDBC/Lettuce/
Jedis/Redisson/Azure SDK/Functions enable overrides (system and environment,
including aliases) are rejected. Compute overwrites inherited
`JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS` and `_JAVA_OPTIONS` with empty values;
the sole approved agent/extension is attached by its fixed startup mechanism.

Public APIM `/contoso/v1` routes forward to Orders `/api`. Original
Authorization and the independently validated
`X-Contoso-Gateway-Authorization` remain separate. Scope/client/principal
policy comes from R8/root configuration, not a hardcoded ambiguous scope.
Portal workload identity must not receive a fabricated human pseudonym.

Orders accepts only the validated trusted-edge UUIDv4, performs the real
Inventory lookup, and returns durable workflow staging separately from
delivery. Run controls require independent verifier permission **and** a
named UTC window of at most one hour. Neither Portal.Invoke nor a window/
certification flag is authorization by itself. Schema/quantity/enum/size
bounds apply; errors never return raw dependency details.

API deployment ZIPs contain the verified agent, hash-frozen extension,
immutable agent config, `app.jar` and `startup.sh`. The script checks existing
attach mechanisms and both hashes before setting the one `JAVA_TOOL_OPTIONS`
agent plus the one extension-loader system property. Function
packages use the one pinned `JAVA_OPTS` attachment and suppress the
`ai-azure-functions` bridge; actual specialization/reload remains a gate.

## Live acceptance remains To Do

1. Reproduce the Contoso-owned, hash-pinned same-provider parent-safe policy
   on actual deployed images, profiles and classloaders. Vendor GA/support
   remains open. No flag-reconstruction/header-promotion workaround is shipped;
   runtime certification mode remains fail-closed on live acceptance.
2. Real cooperating library/root builds, packaging and cross-reviews.
3. Exact App Service/Functions vendor/patch/image/worker, one attach,
   effective SDK/data/bridge suppression and role/instance mapping.
4. Actual Entra/gateway/Portal policy, HMAC rotation and permissions; no
   directory, RBAC or provisioning writes are authorized by local tests.
5. Real PostgreSQL/Redis and four SDK transports, token lifecycle,
   idempotency/retry/DLQ/replay/fan-in/batch, native link retention and privacy.
6. Authenticated Azure ingestion, graceful shutdown/backpressure/redeploy,
   SLO/capacity and approved cost/quota/region/SKU.

`Gate-05.ps1 -RequireLive` fails while these are unresolved. Fixtures,
source-compilation, ledger state, majority votes and startup are never
substitutes for live certification. Structured results are written to
`evidence\java-local\validation.json`.
`Gate-02.ps1 -RequireArtifacts` additionally fails on an absent/unhashed
sampler extension or unfrozen loader/provider inventory. R7 owns the
implementation and actual pinned-agent sampler probe; no application
`GlobalOpenTelemetry.set`, SDK/provider construction or `setSampler`
workaround is permitted.
