# Contoso Order Aggregator

`contosoAggregatorPoll` receives real Service Bus results and bounded Event Hubs
batches through the managed-identity SDK runtime. Aggregation is persisted,
idempotent and root-with-links; arrival order never chooses a parent. Event
Hubs offsets advance only after the processed batch's durable outcomes succeed,
using a fenced PostgreSQL partition lease.

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
mvn -B -ntp -f .\contoso-corr-poc\workers\aggregator\pom.xml package
```

Use the shared runtime settings and separately authorized PostgreSQL migration/
principal bootstrap. The prepared hub has one partition so the controlled
mixed-context demo can reach one batch. Links are bounded, never truncated.
Effective Functions host/extension, actual broker delivery, native exported
links and checkpoint recovery remain VERIFY. Packaging is not certification.
