# Contoso requested replay CLI

The real `ReplayMain` uses the Fulfillment managed identity for orders,
Fulfillment-subscription and legacy-poison work, or the Notification identity
for its own subscription. It does not impersonate the original producer.

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
mvn -B -ntp -f .\contoso-corr-poc\workers\replay\pom.xml package
```

Run the packaged `replay-1.0.0.jar` with `--source ORDERS_DLQ`,
`FULFILLMENT_DLQ`, `NOTIFY_DLQ`, or `LEGACY_POISON`, after configuring the one
pinned agent, sampler and explicit suppression flags exactly as for the owning
worker. The API must first persist an authorized `RunControl.REPLAY` request;
there is no force flag.

Replay commits a unique new message/outbox before completing the old DLQ
delivery. Send failures leave durable pending work for the owning worker.
Business identity is retained, message identity changes, and native links
point to the original context. Azure authorization, live lock/settlement and
exported replay graph remain NOT RUN. No cloud writes are authorized by build.
