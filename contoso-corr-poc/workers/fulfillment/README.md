# Contoso Fulfillment Worker

Real SDK-managed Java Functions timer entry: `contosoFulfillmentPoll`.
It drains the owned durable outbox and receives Service Bus orders and the
Fulfillment topic subscription, the Event Grid CloudEvents relay, and Storage
Queue jobs. Requested dead-letter replays become new durable linked work.

Build from the repository root:

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
mvn -B -ntp -f .\contoso-corr-poc\workers\fulfillment\pom.xml package
```

The real `messaging-core` artifact must be installed first, or build through the
root reactor. Production startup uses the one pinned agent/sampler, explicit
automatic-instrumentation suppression, silent SDK loggers, managed identity,
and the shared PostgreSQL schema. No startup migration is performed.

`CONTOSO_POLL_SCHEDULE` must be provided; the prepared topology uses one minute.
The pinned Java timer annotation does **not** expose `useMonitor`. Effective
timer extension/host monitoring, JDK/worker build, lock-renewal and Azure
delivery evidence remain VERIFY; packaging is not a live/native-binding pass.
