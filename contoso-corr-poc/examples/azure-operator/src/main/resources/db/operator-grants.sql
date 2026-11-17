GRANT USAGE ON SCHEMA contoso,contoso_operator TO "__OPERATOR_ROLE__","__WATCHDOG_ROLE__";
GRANT SELECT ON contoso.environment_marker,contoso.inventory_item,contoso.inventory_reservation,
    contoso.async_workflow,contoso.async_fault,contoso.async_outbox,contoso.async_publication,
    contoso.async_inbox,contoso.async_attempt,contoso.async_effect,contoso.async_contributor,
    contoso.async_replay TO "__OPERATOR_ROLE__","__WATCHDOG_ROLE__";
GRANT UPDATE(available,revision) ON contoso.inventory_item TO "__OPERATOR_ROLE__","__WATCHDOG_ROLE__";
GRANT DELETE ON contoso.inventory_reservation TO "__OPERATOR_ROLE__","__WATCHDOG_ROLE__";
GRANT SELECT,INSERT,UPDATE,DELETE ON contoso_operator.run,contoso_operator.lease,
    contoso_operator.work,contoso_operator.event TO "__OPERATOR_ROLE__";
GRANT SELECT,UPDATE ON contoso_operator.run TO "__WATCHDOG_ROLE__";
GRANT SELECT,DELETE ON contoso_operator.lease TO "__WATCHDOG_ROLE__";
GRANT SELECT ON contoso_operator.work TO "__WATCHDOG_ROLE__";
GRANT SELECT,INSERT ON contoso_operator.event TO "__WATCHDOG_ROLE__";

GRANT USAGE ON SCHEMA contoso_operator TO "__FIXTURE_ROLE__";
GRANT SELECT ON contoso_operator.active_fault TO "__FIXTURE_ROLE__";

CREATE OR REPLACE FUNCTION contoso_operator.record_fixture_event(
    requested_run UUID, requested_operation UUID, requested_kind TEXT, facts TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $operator_fixture$
DECLARE
    data JSONB;
BEGIN
    IF requested_run IS NULL OR requested_operation IS NULL OR requested_kind IS NULL OR facts IS NULL
       OR session_user <> '__FIXTURE_ROLE__'
       OR requested_kind NOT IN ('INVENTORY_SDK','INVENTORY_FINISHED','DATA_CANARIES')
       OR octet_length(facts)>32768
       OR NOT EXISTS (
           SELECT 1 FROM contoso_operator.run r JOIN contoso_operator.lease l ON l.run_id=r.run_id
           WHERE r.run_id=requested_run AND r.phase IN ('ACTIVE','DRAINING')
       ) THEN
        RAISE EXCEPTION 'FIXTURE_OBSERVATION_REJECTED' USING ERRCODE='42501';
    END IF;
    data := facts::jsonb;
    IF jsonb_typeof(data)<>'object' THEN
        RAISE EXCEPTION 'FIXTURE_OBSERVATION_REJECTED' USING ERRCODE='42501';
    END IF;
    IF requested_kind='INVENTORY_SDK' THEN
        IF NOT (data ?& ARRAY['traceId','spanId','sdkSampled','sdkRecording','businessInvocationId','fault','requestObservationId'])
           OR NOT COALESCE(
               (data->>'traceId') ~ '^[0-9a-f]{32}$' AND (data->>'traceId')<>repeat('0',32)
               AND (data->>'spanId') ~ '^[0-9a-f]{16}$' AND (data->>'spanId')<>repeat('0',16)
               AND jsonb_typeof(data->'sdkSampled')='boolean' AND jsonb_typeof(data->'sdkRecording')='boolean'
               AND (data->>'businessInvocationId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               AND (data->>'fault') IN ('NONE','INVENTORY_TIMEOUT','POSTGRES_ERROR','DATA_CANARY')
               AND (data->>'requestObservationId')=requested_operation::text, FALSE)
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(data) k WHERE k NOT IN
               ('traceId','spanId','sdkSampled','sdkRecording','businessInvocationId','fault','requestObservationId','inboundTraceparent'))
           OR data ? 'inboundTraceparent' AND NOT COALESCE(
               (data->>'inboundTraceparent') ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$', FALSE) THEN
            RAISE EXCEPTION 'FIXTURE_OBSERVATION_REJECTED' USING ERRCODE='42501';
        END IF;
    END IF;
    IF requested_kind='INVENTORY_FINISHED' AND data<>'{"completed":true}'::jsonb THEN
        RAISE EXCEPTION 'FIXTURE_OBSERVATION_REJECTED' USING ERRCODE='42501';
    END IF;
    IF requested_kind='DATA_CANARIES' AND data<>
        '{"sqlLiteralAndParameterExecuted":true,"redisKeyValueScriptAndArgumentExecuted":true,"readOnlyEffects":true}'::jsonb THEN
        RAISE EXCEPTION 'FIXTURE_OBSERVATION_REJECTED' USING ERRCODE='42501';
    END IF;
    INSERT INTO contoso_operator.event(event_id,run_id,kind,observed_at,facts_json,operation_id)
    VALUES(gen_random_uuid(),requested_run,requested_kind,CURRENT_TIMESTAMP,facts,requested_operation);
END;
$operator_fixture$;
REVOKE ALL ON FUNCTION contoso_operator.record_fixture_event(UUID,UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION contoso_operator.record_fixture_event(UUID,UUID,TEXT,TEXT) TO "__FIXTURE_ROLE__";
