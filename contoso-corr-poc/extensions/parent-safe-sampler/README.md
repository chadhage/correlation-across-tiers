# Contoso same-provider parent-safe sampler

GAV `com.contoso:contoso-parent-safe-sampler:1.0.0`; one normal JAR and one
`AutoConfigurationCustomizerProvider` service. Main code only wraps the passed
Microsoft `DelegatingSampler`. Any valid unsampled parent returns DROP **before**
its delegate/overrides; all other arguments/results delegate unchanged. No SDK,
provider/global/builder/setSampler/exporter is constructed. The guard remains
installed for production, certification and restart/reconfiguration.

Compiler dependencies are SDK-trace/common/autoconfigure-SPI **1.65.0 provided**,
API/context provided. SPI's aggregate SDK dependency is explicitly excluded.
No shaded/repackaged SDK/API implementation or dependency JAR is in the artifact.
R4 owns parent Maven/versions; only this child activates the explicitly approved
provided-only exceptions. Do not skip Enforcer or put this JAR on app classpath.

Load exactly the hash-frozen JAR using `-Dotel.javaagent.extensions=<one JAR>`.
The artifact SHA/source/ABI/provider/service/loader are in R4's
`config\versions.lock.json`, not a second editable inventory.

## Executed local proof

Using existing portable Temurin **25.0.5+8**, Maven **3.10.0**, actual Microsoft
agent **3.7.10** checksum `93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec`:

- Eight unit tests and provided-only Maven package succeeded.
- Real native SERVER + native HTTP CLIENT loopback ingestion, valid `01`/`00`,
  and 100→0→100 restart produced exact native counts **[2,0,2]**.
- Observed loader `io.opentelemetry.javaagent.tooling.ExtensionClassLoader`,
  lazy delegate `com.microsoft.applicationinsights.agent.internal.sampling.DelegatingSampler`,
  delegate loader `io.opentelemetry.javaagent.bootstrap.AgentClassLoader`;
  one SPI registration/process, API-only app classpath and fresh span IDs.
- Actual `00` outgoing context stays `00`; absent exported Java spans are
  reported, not full-fidelity claims. Parent IDs/trace IDs are not repaired.
- JAR SHA `08592fa4f8fea7b7d259efd2ea38753d9ddc0e9abed05c2e42b62d7bbf2218ce`.

The real experiment initially exposed two concrete mistakes and was fixed:
API/context 1.65 additionally requires public `opentelemetry-common` (not
SDK-common) on the API-only fixture CP; Microsoft forces Java HTTP Client
instrumentation on, so the final fixture uses a native client, not a duplicate
manual CLIENT. No dummy telemetry rows or second SDK were used.

Run from project root:

```powershell
. .\tools\observability\Use-Portable.ps1 -ToolsRoot <existing-R4-tools>
& $env:CONTOSO_MAVEN_EXE -s $env:CONTOSO_MAVEN_SETTINGS -B -f .\extensions\parent-safe-sampler\pom.xml package
$env:CONTOSO_AGENT_JAR = <hash-pinned-agent-path>
node .\tools\observability\probe-parent-safe.mjs
```

Generated evidence: `target\agent-probe\result.json`, actual carrier/runtime
observations and actual native agent envelopes. All are explicitly
`real-local-agent-loopback`, **certificationEligible=false**. This proves
Contoso-owned code against this local pin, not Microsoft vendor GA/support,
JDK/host production coverage, APIM flag behavior or the eight-boundary Azure
certificate. Those remain **To Do**. Never enable preview parentBased, patch
the agent, rewrite a sampled bit or waive a missing `00`/positive path.
