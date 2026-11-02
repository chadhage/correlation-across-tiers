GRANT UPDATE(state,updated_at) ON contoso.async_workflow TO __ROLE__;
GRANT INSERT(message_id,workflow_id,destination,draft_json),UPDATE(state,publish_attempt,lease_token,lease_until,last_error) ON contoso.async_outbox TO __ROLE__;
GRANT INSERT(publication_id,message_id,destination,envelope_hash,envelope_json) ON contoso.async_publication TO __ROLE__;
GRANT INSERT(message_id,branch),UPDATE(attempt_count,lease_token,lease_until,completed) ON contoso.async_inbox TO __ROLE__;
GRANT INSERT(attempt_id,workflow_id,message_id,branch,attempt_count,delivery_count,process_traceparent,process_tracestate,outcome),UPDATE(outcome) ON contoso.async_attempt TO __ROLE__;
GRANT INSERT(effect_id,effect_key,workflow_id,message_id,branch,process_traceparent,process_tracestate) ON contoso.async_effect TO __ROLE__;
GRANT INSERT(workflow_id,branch,message_id,result_message_id,process_traceparent,process_tracestate) ON contoso.async_contributor TO __ROLE__;
GRANT INSERT(original_message_id,source,workflow_id,new_message_id) ON contoso.async_replay TO __ROLE__;
