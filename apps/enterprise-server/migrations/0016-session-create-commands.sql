-- Command identity only. The native owner retains sessions, workspaces and
-- their history. No transcript, password, login token or model input is stored.
CREATE TABLE haas.session_create_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL, request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  native_session_id TEXT NOT NULL, intent JSONB NOT NULL CHECK (jsonb_typeof(intent)='object'),
  target JSONB NOT NULL CHECK (jsonb_typeof(target)='object'),
  outcome TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (outcome IN ('unconfirmed','created')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, command_id), UNIQUE (tenant_id, actor_user_id, idempotency_key),
  UNIQUE (tenant_id, actor_user_id, native_session_id),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES haas.users(tenant_id, user_id),
  CHECK ((outcome='unconfirmed' AND confirmed_at IS NULL) OR (outcome='created' AND confirmed_at IS NOT NULL))
);
CREATE FUNCTION haas.guard_session_create_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    OLD.outcome<>'unconfirmed' OR NEW.outcome<>'created'
    OR (to_jsonb(NEW)-ARRAY['outcome','confirmed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','confirmed_at'])
  )) THEN RAISE EXCEPTION 'native session command identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_create_command_immutable BEFORE UPDATE OR DELETE ON haas.session_create_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_session_create_command();
