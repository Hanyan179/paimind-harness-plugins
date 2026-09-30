-- Operation identity and redacted evidence only; native owners retain settings
-- and secrets. HMAC inputs are never stored, including write-only credentials.
CREATE TABLE haas.connector_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  login_session_id UUID NOT NULL, idempotency_key UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  target_user_id UUID NOT NULL, intent JSONB NOT NULL, target_pin JSONB NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (outcome IN ('unconfirmed','saved-disabled','unchanged','conflict','superseded')),
  confirmation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, command_id), UNIQUE (tenant_id, actor_user_id, idempotency_key),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, target_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, login_session_id) REFERENCES haas.login_sessions(tenant_id, session_id),
  CHECK (coalesce(jsonb_typeof(intent)='object' AND jsonb_typeof(target_pin)='object'
    AND jsonb_typeof(intent->'change')='object'
    AND ((intent->'change') - ARRAY['kind','entryId']) = '{}'::jsonb
    AND intent->'change'->>'kind' IN ('upsert','remove')
    AND intent->'change'->>'entryId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', false)),
  CHECK ((outcome='unconfirmed' AND confirmation IS NULL AND confirmed_at IS NULL)
    OR coalesce((outcome<>'unconfirmed' AND confirmation IS NOT NULL AND confirmed_at IS NOT NULL
      AND confirmation->>'commandId'=command_id::text AND confirmation->>'outcome'=outcome), false))
);
CREATE UNIQUE INDEX connector_command_unconfirmed_target ON haas.connector_commands(tenant_id,target_user_id) WHERE outcome='unconfirmed';
CREATE FUNCTION haas.guard_connector_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    OLD.outcome<>'unconfirmed' OR NEW.outcome='unconfirmed'
    OR (to_jsonb(NEW)-ARRAY['outcome','confirmation','confirmed_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['outcome','confirmation','confirmed_at'])
  )) THEN RAISE EXCEPTION 'connector command identity and terminal receipts are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER connector_command_immutable BEFORE UPDATE OR DELETE ON haas.connector_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_connector_command();
