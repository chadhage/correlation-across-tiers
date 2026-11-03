# Correlation across tiers

## Start with the context.

A short orientation to the Contoso correlation POC: why it exists, what to
inspect, and how to move from the first request to the harder cases.

**Read-only source snapshot | NOT CERTIFIED**

For the interactive version, [open the microsite][microsite].

## 01 / Purpose

### Why this exists.

A request can cross a browser, gateway, Java services, data clients and
message-driven workers. A shared trace ID alone does not explain that journey.
This repository makes the expected propagation, span relationships and trust
rules explicit; this site makes those contracts easier to inspect and discuss.

Use the [expected relationships][topology] to ask where context should continue,
branch or start again, rather than treating a plausible diagram as proof.

## 02 / Contents

### What you will find.

Explore [15 cataloged scenarios][walkthrough], boundary graphs, sequence diagrams
and a shared contract inspector. Alongside them are
[recorded local results and receipt checks][evidence], embedded source documents,
and [manual run, reset and KQL templates][operations].

The diagrams describe source-defined expectations, not a live trace capture.
Browsing does not emit traffic or query telemetry.

## 03 / Audience

### Who this is for.

Application and platform engineers wiring propagation; architects and SREs
reviewing asynchronous behavior; and reviewers tracing a claim back to evidence.
Some familiarity with HTTP and spans helps, but no deployed environment or
sign-in is needed to read the walkthrough. The [boundary inspector][topology]
connects each selected operation to its role, kind and declared relationships.

## 04 / Getting started

### Start with one request. Then repeat.

Begin with [Demo 01, the synchronous golden path][demo-01], to follow
browser-to-data continuity. For every scenario after that, keep the same
inspection routine:

1. **Read the intent.** Check the purpose, acceptance criteria, expected
   boundaries and any separate owner action in the [scenario detail][walkthrough].
   Open **Read scenario source** for its full instructions.
2. **Inspect both views.** In [Topology][topology], switch between the boundary
   graph and sequence diagram. Select a boundary or row; compare parents, links
   and root rules with its contract.
3. **Check what was actually recorded.** Read the
   [evidence scope and receipt status][evidence]. A historical local result is
   not a new execution or full-path acceptance.
4. **Execute only when separately authorized.** Review [Operations][operations]
   and the presenter runbook before using any template. Native runs require
   approved adapters, reviewed inputs and a run-owned baseline; reset and
   restoration are part of the procedure.
5. **Move to the next question.** Use search, filters, Previous or Next, or choose
   any scenario below. Repeat the same review rather than assuming a previous
   scenario's result carries forward.

**Every scenario, from the current catalog:**

- [01 - Synchronous golden path][demo-01]
- [02 - Portal SSR versus SPA][demo-02]
- [03 - Inbound Gateway context][demo-03]
- [04 - Trusted business invocation identity][demo-04]
- [05 - Errors and timeouts][demo-05]
- [06 - Service Bus retry attempts][demo-06]
- [07 - Dead-letter and replay][demo-07]
- [08 - Fan-out and linked fan-in][demo-08]
- [09 - Event Hubs mixed-context batch][demo-09]
- [10 - CloudEvents and Storage Queue][demo-10]
- [11 - Spoofed message context][demo-11]
- [12 - Data-tier safety][demo-12]
- [13 - Identity and privacy][demo-13]
- [14 - Orphan-candidate triage][demo-14]
- [15 - Sampling, load and rollback][demo-15]

## 05 / Observations

### Patterns worth noticing.

The interesting cases are where a simple chain stops being an honest description:

- [Fan-in][demo-08] and [mixed-context batches][demo-09] retain contributor links
  instead of inventing one convenient parent.
- [Retries][demo-06] represent separate attempts; [dead-letter replay][demo-07]
  has its own declared root and link rules.
- [PostgreSQL and Redis operations][demo-12] are logical CLIENT spans, not invented
  database server continuations.
- Sequence order follows declared dependencies, not measured durations,
  concurrency or delivery counts. Compare both views in [Topology][topology].

## 06 / Considerations

### Keep the scope attached.

**NOT CERTIFIED** is a boundary on the claims, not a decorative label. Local
records and matching digests do not establish current runtime parity, Azure
full-path acceptance, global privacy or zero loss.

- Investigate missing or changed receipts before relying on
  [recorded evidence][evidence].
- Fault injection, native traffic, authentication changes and reset need
  separate authorization. Never purge shared queues or unowned messages; review
  [the operating procedure][operations].
- Optional environment URLs are launch links, not health checks. Keep
  credentials and tokens out of settings and URLs.

## 07 / References and sources

### Go back to the source.

The microsite opens embedded, build-time source snapshots. Repository-relative
paths and SHA-256 digests remain visible; the verification register is an
explicitly labeled excerpt. They document the snapshot, not an automatic
attestation of a running environment.

The links below open the corresponding repository files. Use the microsite's
[embedded source controls][operations] to inspect its snapshot content and
digests.

- [Architecture notes](contoso-corr-poc/docs/ARCHITECTURE.md)
- [Exact boundary map](contoso-corr-poc/contracts/expected-boundary-map.v1.json)
- [Scenario catalog](contoso-corr-poc/demos/catalog.json)
- [Presenter and operations runbook](contoso-corr-poc/docs/DEMO_RUNBOOK.md)
- [Verification register](contoso-corr-poc/config/verification-register.v1.json)
  (the microsite displays selected fields)
- [Certification report](contoso-corr-poc/docs/CERTIFICATION_REPORT.md)
- [Residual limitations](contoso-corr-poc/docs/RESIDUAL_LIMITATIONS.md)
- [KQL procedure contracts](contoso-corr-poc/kql/README.md)

**[Start with Demo 01][demo-01]** | [Continue exploring][walkthrough]

[microsite]: https://chadhage.github.io/correlation-across-tiers/
[walkthrough]: https://chadhage.github.io/correlation-across-tiers/#walkthrough
[topology]: https://chadhage.github.io/correlation-across-tiers/#topology
[evidence]: https://chadhage.github.io/correlation-across-tiers/#evidence
[operations]: https://chadhage.github.io/correlation-across-tiers/#operations
[demo-01]: https://chadhage.github.io/correlation-across-tiers/#demo-01
[demo-02]: https://chadhage.github.io/correlation-across-tiers/#demo-02
[demo-03]: https://chadhage.github.io/correlation-across-tiers/#demo-03
[demo-04]: https://chadhage.github.io/correlation-across-tiers/#demo-04
[demo-05]: https://chadhage.github.io/correlation-across-tiers/#demo-05
[demo-06]: https://chadhage.github.io/correlation-across-tiers/#demo-06
[demo-07]: https://chadhage.github.io/correlation-across-tiers/#demo-07
[demo-08]: https://chadhage.github.io/correlation-across-tiers/#demo-08
[demo-09]: https://chadhage.github.io/correlation-across-tiers/#demo-09
[demo-10]: https://chadhage.github.io/correlation-across-tiers/#demo-10
[demo-11]: https://chadhage.github.io/correlation-across-tiers/#demo-11
[demo-12]: https://chadhage.github.io/correlation-across-tiers/#demo-12
[demo-13]: https://chadhage.github.io/correlation-across-tiers/#demo-13
[demo-14]: https://chadhage.github.io/correlation-across-tiers/#demo-14
[demo-15]: https://chadhage.github.io/correlation-across-tiers/#demo-15
