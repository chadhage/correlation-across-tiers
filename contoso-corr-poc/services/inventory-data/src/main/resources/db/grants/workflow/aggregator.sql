GRANT UPDATE(state,updated_at) ON contoso.async_workflow TO __ROLE__;
GRANT UPDATE(state,publish_attempt,lease_token,lease_until,last_error) ON contoso.async_outbox TO __ROLE__;
GRANT INSERT(message_id,branch),UPDATE(attempt_count,lease_token,lease_until,completed,source_traceparent,source_tracestate,source_hash,source_publisher) ON contoso.async_inbox TO __ROLE__;
GRANT INSERT(attempt_id,workflow_id,message_id,branch,attempt_count,delivery_count,process_traceparent,process_tracestate,outcome),UPDATE(outcome,process_traceparent,process_tracestate) ON contoso.async_attempt TO __ROLE__;
GRANT INSERT(effect_id,effect_key,workflow_id,message_id,branch,process_traceparent,process_tracestate) ON contoso.async_effect TO __ROLE__;
GRANT INSERT(partition_id),UPDATE(offset_value,sequence_number,receive_attempt,lease_token,lease_until) ON contoso.async_checkpoint TO __ROLE__;
GRANT INSERT(partition_id,offset_value,sequence_number,reason_code) ON contoso.async_quarantine TO __ROLE__;
