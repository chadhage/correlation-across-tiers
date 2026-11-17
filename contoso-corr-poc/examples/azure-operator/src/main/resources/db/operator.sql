CREATE SCHEMA IF NOT EXISTS contoso_operator;

CREATE TABLE IF NOT EXISTS contoso_operator.run (
    run_id UUID PRIMARY KEY,
    demo_id INTEGER NOT NULL CHECK (demo_id BETWEEN 1 AND 15),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    phase VARCHAR(16) NOT NULL,
    fault VARCHAR(24) NOT NULL DEFAULT 'NONE',
    baseline_json VARCHAR(32768) NOT NULL,
    restore_json VARCHAR(32768)
);

CREATE TABLE IF NOT EXISTS contoso_operator.lease (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    run_id UUID NOT NULL UNIQUE REFERENCES contoso_operator.run(run_id)
);

CREATE TABLE IF NOT EXISTS contoso_operator.work (
    workflow_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES contoso_operator.run(run_id),
    workflow_type VARCHAR(8) NOT NULL CHECK (workflow_type IN ('ORDER','RUN')),
    invocation_id UUID
);

CREATE TABLE IF NOT EXISTS contoso_operator.event (
    event_id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES contoso_operator.run(run_id),
    kind VARCHAR(32) NOT NULL,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    facts_json VARCHAR(32768) NOT NULL,
    operation_id UUID
);

CREATE OR REPLACE VIEW contoso_operator.active_fault AS
SELECT r.run_id,r.fault,r.expires_at
FROM contoso_operator.run r JOIN contoso_operator.lease l ON l.run_id=r.run_id
WHERE r.phase='ACTIVE' AND r.expires_at>CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS operator_event_run ON contoso_operator.event(run_id,kind,operation_id);
