-- Governance only. Native Include retains configuration and private version
-- keys; this table stores an opaque exact reference, never configuration.
CREATE TABLE haas.connector_approvals (
  tenant_id TEXT NOT NULL, target_user_id UUID NOT NULL, entry_id TEXT NOT NULL
    CHECK (entry_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  configuration_version TEXT NOT NULL CHECK (configuration_version ~ '^[a-f0-9]{64}$'),
  server_name TEXT NOT NULL CHECK (server_name ~ '^[A-Za-z0-9_-]{1,32}$'),
  transport TEXT NOT NULL CHECK (transport IN ('stdio','streamable-http')),
  cell_id UUID NOT NULL, volume_name TEXT NOT NULL CHECK (volume_name ~ '^paimind-haas-member-[a-z0-9-]{1,100}$'),
  image_id TEXT NOT NULL CHECK (image_id ~ '^sha256:[a-f0-9]{64}$'),
  policy_digest TEXT NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('approved','revoked')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  updated_by UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,target_user_id,entry_id),
  FOREIGN KEY (tenant_id,target_user_id) REFERENCES haas.users(tenant_id,user_id),
  FOREIGN KEY (tenant_id,updated_by) REFERENCES haas.users(tenant_id,user_id)
);
CREATE FUNCTION haas.guard_connector_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    ROW(NEW.tenant_id,NEW.target_user_id,NEW.entry_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.target_user_id,OLD.entry_id)
    OR NEW.revision <> OLD.revision + 1
    OR (NEW.decision='revoked' AND
      (to_jsonb(NEW)-ARRAY['decision','revision','reason','updated_by','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['decision','revision','reason','updated_by','updated_at']))
  )) THEN RAISE EXCEPTION 'connector approval identity and revision must be preserved'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER connector_approval_guard BEFORE UPDATE OR DELETE ON haas.connector_approvals
  FOR EACH ROW EXECUTE FUNCTION haas.guard_connector_approval();
