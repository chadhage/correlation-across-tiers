# Contoso correlation architecture

Generated from the single expected boundary map. This is the declared topology, not a claim of observed certification.

```mermaid
flowchart LR
  storefront_http["Contoso Storefront HTTP dependency<br/>CLIENT"]
  portal_request["Contoso Portal SSR render<br/>SERVER"]
  portal_gateway["Contoso Portal Gateway call<br/>CLIENT"]
  gateway_request["Contoso Gateway request<br/>SERVER"]
  gateway_backend["Contoso Gateway backend dependency<br/>CLIENT"]
  orders_request["Contoso Orders request<br/>SERVER"]
  orders_validation["Contoso Orders validation<br/>INTERNAL"]
  orders_inventory["Contoso Orders Inventory call<br/>CLIENT"]
  inventory_request["Contoso Inventory request<br/>SERVER"]
  postgres_logical["Contoso PostgreSQL logical operation<br/>CLIENT"]
  redis_logical["Contoso Managed Redis logical operation<br/>CLIENT"]
  orders_servicebus_send["Contoso Service Bus SEND<br/>PRODUCER"]
  orders_eventgrid_send["Contoso CloudEvent SEND<br/>PRODUCER"]
  orders_eventhubs_send["Contoso Event Hubs SEND<br/>PRODUCER"]
  orders_storage_send["Contoso Storage Queue SEND<br/>PRODUCER"]
  fulfillment_process["Contoso Fulfillment PROCESS attempt<br/>CONSUMER"]
  notify_process["Contoso Notify PROCESS attempt<br/>CONSUMER"]
  fulfillment_result["Contoso Fulfillment result SEND<br/>PRODUCER"]
  notify_result["Contoso Notify result SEND<br/>PRODUCER"]
  aggregator_result["Contoso Aggregator result PROCESS<br/>CONSUMER"]
  aggregator_batch["Contoso mixed-context batch<br/>CONSUMER"]
  aggregator_fanin["Contoso fan-in aggregation<br/>INTERNAL"]
  aggregator_replay["Contoso authorized replay coordination<br/>INTERNAL"]
  orders_replay_send["Contoso replay SEND<br/>PRODUCER"]
  storefront_http -->|parent| gateway_request
  portal_request -->|parent| portal_gateway
  portal_gateway -->|parent| gateway_request
  gateway_request -->|parent| gateway_backend
  gateway_backend -->|parent| orders_request
  orders_request -->|parent| orders_validation
  orders_request -->|parent| orders_inventory
  orders_inventory -->|parent| inventory_request
  inventory_request -->|parent| postgres_logical
  inventory_request -->|parent| redis_logical
  orders_servicebus_send -->|parent| fulfillment_process
  orders_servicebus_send -->|parent| notify_process
  orders_eventgrid_send -->|parent| fulfillment_process
  orders_storage_send -->|parent| fulfillment_process
  fulfillment_process -.->|link| fulfillment_result
  notify_process -.->|link| notify_result
  fulfillment_result -->|parent| aggregator_result
  notify_result -->|parent| aggregator_result
  fulfillment_process -.->|link| aggregator_fanin
  notify_process -.->|link| aggregator_fanin
  fulfillment_result -.->|link| aggregator_fanin
  notify_result -.->|link| aggregator_fanin
  orders_eventhubs_send -.->|link| aggregator_batch
  orders_servicebus_send -.->|link| aggregator_replay
  aggregator_replay -.->|link| orders_replay_send
  Entra["Microsoft Entra authentication"]
  Vault["Contoso Key Vault references / HMAC storage"]
  Appi["Contoso Application Insights"]
  Law["Contoso Log Analytics"]
  Entra -.->|authorization, not trace identity| gateway_request
  Vault -.->|safe configuration, never secret evidence| orders_request
  orders_request -.->|direct Azure Monitor export| Appi
  portal_request -.->|independent Node export| Appi
  storefront_http -.->|public browser ingestion| Appi
  Appi --> Law
```

Solid edges are parent relationships; dotted edges are links or labelled non-causal configuration/export flows.
PostgreSQL and Redis nodes are CLIENT operations, not database server continuations.

## Declared new-root boundaries

- portal.request: A document render and browser page telemetry are distinct roots unless context is actually propagated.
- aggregator.fanin: Complete persisted contributors are links; arrival order never selects a parent.
- aggregator.batch: Mixed-message contexts are bounded links; the first message is never parent.
- aggregator.replay: Replay is new linked work, not continuation of an active ancient parent.
- orders.replay.send: Durable replay/outbox dispatch links its authorized predecessor.

## Transport and trust limits

- Service Bus, Event Hubs, Event Grid, and Queue carry context; no invented broker spans.
- VNet-integrated workers use the selected authenticated TLS transport endpoints. Integration is not Private Link.
- PostgreSQL and Managed Redis private connectivity is independent of application ingress and SCM deployment.
- Result/outbox work retains real contributor contexts; fan-in and mixed batches have no arbitrary input parent.
- Browser telemetry is publicly injectable; controlled synthetic certification is not universal actor attestation.
- Complete sampled positive vectors and strict unsampled propagation are separate, mandatory assertions.
