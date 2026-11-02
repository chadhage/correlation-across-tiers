GRANT INSERT(workflow_id,invocation_id,workflow_type,scenario,demo_id,failure_budget,state,order_id,sku,quantity) ON contoso.async_workflow TO __ROLE__;
GRANT UPDATE(last_control_target,paused,replay_requested,failure_budget,state,updated_at) ON contoso.async_workflow TO __ROLE__;
GRANT INSERT(workflow_id,target,paused,replay_requested,failure_budget),UPDATE(paused,replay_requested,failure_budget),DELETE ON contoso.async_fault TO __ROLE__;
GRANT INSERT(message_id,workflow_id,destination,draft_json),UPDATE(state,publish_attempt,lease_token,lease_until,last_error) ON contoso.async_outbox TO __ROLE__;
GRANT INSERT(publication_id,message_id,destination,envelope_hash,envelope_json) ON contoso.async_publication TO __ROLE__;
