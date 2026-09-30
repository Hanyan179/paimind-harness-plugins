-- Immutable command identity and original carrier acknowledgement only.
-- This is NOT a pending approval registry or an execution/decision journal.
-- Original asked/decided records and the pending consumer stay in Harness.
CREATE TABLE haas.session_approval_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL, request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  cell_id UUID NOT NULL, native_session_id TEXT NOT NULL CHECK (length(native_session_id) BETWEEN 1 AND 200),
  native_approval_id UUID NOT NULL, native_rpc_id TEXT NOT NULL CHECK (length(native_rpc_id) BETWEEN 1 AND 200),
  expected_version TEXT NOT NULL CHECK (expected_version ~ '^[A-Za-z0-9_-]{43}$'),
  preset_id TEXT NOT NULL CHECK (length(preset_id) BETWEEN 1 AND 200),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  target JSONB NOT NULL CHECK (jsonb_typeof(target)='object' AND target->>'cellId'=cell_id::text),
  carrier_accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, command_id), UNIQUE (tenant_id, actor_user_id, idempotency_key),
  UNIQUE (tenant_id, actor_user_id, cell_id, native_session_id, native_approval_id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES haas.users(tenant_id, user_id),
  CHECK (carrier_accepted = (acknowledged_at IS NOT NULL))
);
CREATE FUNCTION haas.guard_session_approval_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    OLD.carrier_accepted OR NOT NEW.carrier_accepted
    OR (to_jsonb(NEW)-ARRAY['carrier_accepted','acknowledged_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['carrier_accepted','acknowledged_at'])
  )) THEN RAISE EXCEPTION 'native approval command identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_approval_command_immutable BEFORE UPDATE OR DELETE ON haas.session_approval_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_session_approval_command();
