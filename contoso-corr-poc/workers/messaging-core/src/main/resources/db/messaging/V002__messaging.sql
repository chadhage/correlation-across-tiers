CREATE SCHEMA IF NOT EXISTS contoso;

CREATE TABLE IF NOT EXISTS contoso.async_workflow (
    workflow_id UUID PRIMARY KEY,
    invocation_id UUID NOT NULL,
    workflow_type VARCHAR(8) NOT NULL CHECK (workflow_type IN ('ORDER','RUN')),
    scenario VARCHAR(20) NOT NULL,
    demo_id INTEGER NOT NULL CHECK (demo_id BETWEEN 0 AND 15),
    failure_budget INTEGER NOT NULL CHECK (failure_budget BETWEEN 0 AND 10),
    last_control_target VARCHAR(24) NOT NULL DEFAULT 'ORDER',
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    replay_requested BOOLEAN NOT NULL DEFAULT FALSE,
    state VARCHAR(32) NOT NULL,
    order_id UUID NOT NULL,
    sku VARCHAR(12) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contoso.async_fault (
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    target VARCHAR(24) NOT NULL,
    paused BOOLEAN NOT NULL DEFAULT FALSE,
    replay_requested BOOLEAN NOT NULL DEFAULT FALSE,
    failure_budget INTEGER CHECK (failure_budget BETWEEN 0 AND 10),
    PRIMARY KEY(workflow_id,target)
);

CREATE TABLE IF NOT EXISTS contoso.async_outbox (
    message_id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    destination VARCHAR(24) NOT NULL,
    draft_json VARCHAR(32768) NOT NULL,
    owner VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    state VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    publish_attempt INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_until TIMESTAMP WITH TIME ZONE,
    last_error VARCHAR(48),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contoso.async_publication (
    publication_id UUID PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES contoso.async_outbox(message_id),
    destination VARCHAR(24) NOT NULL,
    envelope_hash CHAR(64) NOT NULL,
    envelope_json VARCHAR(32768) NOT NULL,
    publisher VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id,destination,envelope_hash)
);

CREATE TABLE IF NOT EXISTS contoso.async_inbox (
    message_id UUID NOT NULL,
    branch VARCHAR(20) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_until TIMESTAMP WITH TIME ZONE,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    receiver VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    source_traceparent VARCHAR(512),
    source_tracestate VARCHAR(512),
    source_hash CHAR(64),
    source_publisher VARCHAR(63),
    PRIMARY KEY(message_id,branch)
);

CREATE TABLE IF NOT EXISTS contoso.async_attempt (
    attempt_id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    message_id UUID NOT NULL,
    branch VARCHAR(20) NOT NULL,
    attempt_count INTEGER NOT NULL,
    delivery_count INTEGER NOT NULL,
    process_traceparent VARCHAR(512),
    process_tracestate VARCHAR(512),
    outcome VARCHAR(32) NOT NULL,
    creator VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id,branch,attempt_count)
);

CREATE TABLE IF NOT EXISTS contoso.async_effect (
    effect_id UUID PRIMARY KEY,
    effect_key UUID NOT NULL,
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    message_id UUID NOT NULL,
    branch VARCHAR(20) NOT NULL,
    process_traceparent VARCHAR(512),
    process_tracestate VARCHAR(512),
    owner VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(effect_key,branch)
);

CREATE TABLE IF NOT EXISTS contoso.async_contributor (
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    branch VARCHAR(20) NOT NULL CHECK (branch IN ('FULFILLMENT','NOTIFY')),
    message_id UUID NOT NULL,
    result_message_id UUID NOT NULL REFERENCES contoso.async_outbox(message_id),
    process_traceparent VARCHAR(512),
    process_tracestate VARCHAR(512),
    publisher VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(workflow_id,branch)
);

CREATE TABLE IF NOT EXISTS contoso.async_checkpoint (
    partition_id VARCHAR(20) PRIMARY KEY,
    offset_value BIGINT NOT NULL DEFAULT -1,
    sequence_number BIGINT NOT NULL DEFAULT -1,
    receive_attempt INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_until TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS contoso.async_replay (
    original_message_id UUID NOT NULL,
    source VARCHAR(24) NOT NULL,
    workflow_id UUID NOT NULL REFERENCES contoso.async_workflow(workflow_id),
    new_message_id UUID NOT NULL REFERENCES contoso.async_outbox(message_id),
    owner VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(original_message_id,source)
);

CREATE TABLE IF NOT EXISTS contoso.async_quarantine (
    partition_id VARCHAR(20) NOT NULL,
    offset_value BIGINT NOT NULL,
    sequence_number BIGINT NOT NULL,
    reason_code VARCHAR(48) NOT NULL,
    receiver VARCHAR(63) NOT NULL DEFAULT CURRENT_USER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(partition_id,offset_value)
);

CREATE INDEX IF NOT EXISTS async_outbox_ready ON contoso.async_outbox(owner,state,lease_until);
CREATE INDEX IF NOT EXISTS async_attempt_workflow ON contoso.async_attempt(workflow_id,created_at);
CREATE INDEX IF NOT EXISTS async_publication_lookup ON contoso.async_publication(message_id,destination,envelope_hash);
