CREATE SCHEMA IF NOT EXISTS contoso;

CREATE TABLE IF NOT EXISTS contoso.environment_marker (
    singleton BOOLEAN PRIMARY KEY CHECK (singleton = TRUE),
    workload VARCHAR(32) NOT NULL CHECK (workload = 'contoso-corr'),
    environment VARCHAR(16) NOT NULL CHECK (environment = 'poc'),
    seed_version INTEGER NOT NULL CHECK (seed_version = 1),
    expected_resource_id VARCHAR(512)
);

CREATE TABLE IF NOT EXISTS contoso.inventory_item (
    sku VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(128) NOT NULL,
    available INTEGER NOT NULL CHECK (available >= 0),
    revision BIGINT NOT NULL CHECK (revision >= 0),
    synthetic BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS contoso.inventory_reservation (
    reservation_id UUID PRIMARY KEY,
    order_id UUID NOT NULL,
    sku VARCHAR(64) NOT NULL REFERENCES contoso.inventory_item(sku),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    state VARCHAR(16) NOT NULL CHECK (state IN ('RESERVED', 'RELEASED')),
    invocation_id UUID NOT NULL,
    synthetic BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contoso_reservation_once UNIQUE (order_id, sku)
);

INSERT INTO contoso.environment_marker(singleton,workload,environment,seed_version)
SELECT TRUE,'contoso-corr','poc',1
WHERE NOT EXISTS (SELECT 1 FROM contoso.environment_marker WHERE singleton=TRUE);

INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic)
SELECT 'CONTOSO-001','Contoso Notebook',20,1,TRUE
WHERE NOT EXISTS (SELECT 1 FROM contoso.inventory_item WHERE sku='CONTOSO-001');
INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic)
SELECT 'CONTOSO-002','Contoso Pen',20,1,TRUE
WHERE NOT EXISTS (SELECT 1 FROM contoso.inventory_item WHERE sku='CONTOSO-002');
INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic)
SELECT 'CONTOSO-003','Contoso Mug',20,1,TRUE
WHERE NOT EXISTS (SELECT 1 FROM contoso.inventory_item WHERE sku='CONTOSO-003');
INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic)
SELECT 'CONTOSO-004','Contoso Tote',20,1,TRUE
WHERE NOT EXISTS (SELECT 1 FROM contoso.inventory_item WHERE sku='CONTOSO-004');
INSERT INTO contoso.inventory_item(sku,display_name,available,revision,synthetic)
SELECT 'CONTOSO-005','Contoso Cap',20,1,TRUE
WHERE NOT EXISTS (SELECT 1 FROM contoso.inventory_item WHERE sku='CONTOSO-005');
