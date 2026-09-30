-- Command identities and native references only; no message body, transcript,
-- credential or reusable execution grant. Native Harness owns every message.
CREATE TABLE haas.session_turn_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  idempotency_key UUID NOT NULL, request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  native_session_id TEXT NOT NULL CHECK (length(native_session_id) BETWEEN 1 AND 200),
  expected_version TEXT NOT NULL CHECK (expected_version ~ '^[A-Za-z0-9_-]{43}$'),
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^[A-Za-z0-9_-]{43}$'),
  target JSONB NOT NULL CHECK (jsonb_typeof(target)='object'),
  outcome TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (outcome IN ('unconfirmed','accepted')),
  native_message_id TEXT, native_seq BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, command_id), UNIQUE (tenant_id, actor_user_id, idempotency_key),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES haas.users(tenant_id, user_id),
  CHECK ((outcome='unconfirmed' AND confirmed_at IS NULL AND native_message_id IS NULL AND native_seq IS NULL)
    OR (outcome='accepted' AND confirmed_at IS NOT NULL AND native_message_id IS NOT NULL
      AND length(native_message_id) BETWEEN 1 AND 200 AND native_seq BETWEEN 0 AND 9007199254740991))
);
CREATE FUNCTION haas.guard_session_turn_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    OLD.outcome<>'unconfirmed' OR NEW.outcome<>'accepted'
    OR (to_jsonb(NEW)-ARRAY['outcome','confirmed_at','native_message_id','native_seq'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['outcome','confirmed_at','native_message_id','native_seq'])
  )) THEN RAISE EXCEPTION 'native turn command identity is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_turn_command_immutable BEFORE UPDATE OR DELETE ON haas.session_turn_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_session_turn_command();
