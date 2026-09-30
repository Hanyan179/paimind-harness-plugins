-- Operator observations only, not a second runtime registry or browser grant.
-- The operator stops/joins the old writer and verifies exclusive owned storage
-- before atomically recording this edge with replacement admission.
CREATE TABLE haas.runtime_replacement_lineage (
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  cell_id UUID NOT NULL REFERENCES haas.runtime_bindings(cell_id),
  source_revision UUID NOT NULL,
  target_revision UUID NOT NULL,
  suspended_revision UUID NOT NULL,
  source_pin JSONB NOT NULL CHECK (jsonb_typeof(source_pin)='object'),
  target_pin JSONB NOT NULL CHECK (jsonb_typeof(target_pin)='object'),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,cell_id,source_revision),
  UNIQUE (tenant_id,cell_id,target_revision),
  FOREIGN KEY (tenant_id,user_id) REFERENCES haas.users(tenant_id,user_id),
  CHECK (source_revision<>target_revision AND suspended_revision<>target_revision),
  CHECK (source_pin->>'tenantId'=tenant_id AND target_pin->>'tenantId'=tenant_id
    AND source_pin->>'userId'=user_id::text AND target_pin->>'userId'=user_id::text
    AND source_pin->>'cellId'=cell_id::text AND target_pin->>'cellId'=cell_id::text
    AND source_pin->>'revision'=source_revision::text AND target_pin->>'revision'=target_revision::text)
);
CREATE FUNCTION haas.guard_runtime_replacement_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'runtime replacement lineage is immutable';
END;
$$;
CREATE TRIGGER runtime_replacement_lineage_immutable BEFORE UPDATE OR DELETE ON haas.runtime_replacement_lineage
  FOR EACH ROW EXECUTE FUNCTION haas.guard_runtime_replacement_lineage();
