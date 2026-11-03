# Contoso Notification Worker

`contosoNotifyPoll` is a real SDK-managed Java Functions timer. It consumes
only the Notification topic subscription, atomically persists its notification
effect, contributor and result outbox, and dispatches owned results. Requested
replays of its own subscription use fresh linked work and preserve business
identity.

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
mvn -B -ntp -f .\contoso-corr-poc\workers\notify\pom.xml package
```

Use the shared `messaging-core` runtime settings and separately approved schema/
identity bootstrap. SDK logging is OFF; application telemetry uses only the
existing agent's API. Set `CONTOSO_POLL_SCHEDULE` to the prepared one-minute
schedule. Azure delivery, permissions, effective timer host/extension, native
span export and privacy remain VERIFY. This is not native trigger parity.
