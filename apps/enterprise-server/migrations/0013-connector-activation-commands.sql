-- Redacted administrator intent and historical outcome, never native config or
-- runtime permission. Separate from unknown configuration writes: reserving an
-- activation must not deny its own exact current approval check. Configuration
-- changes and new approvals still serialize against either pending command.
CREATE TABLE haas.connector_activation_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  login_session_id UUID NOT NULL, idempotency_key UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  target_user_id UUID NOT NULL, intent JSONB NOT NULL, target_pin JSONB NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (outcome IN ('unconfirmed','enabled','disabled','conflict','superseded')),
  confirmation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,command_id), UNIQUE (tenant_id,actor_user_id,idempotency_key),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES haas.users(tenant_id,user_id),
  FOREIGN KEY (tenant_id,target_user_id) REFERENCES haas.users(tenant_id,user_id),
  FOREIGN KEY (tenant_id,login_session_id) REFERENCES haas.login_sessions(tenant_id,session_id),
  CHECK (coalesce(jsonb_typeof(intent)='object' AND jsonb_typeof(target_pin)='object'
    AND intent - ARRAY['targetUserId','expectedCellRevision','expectedConfigurationRevision','entryId','configurationVersion','enabled','expectedApprovalRevision','reason','confirmed'] = '{}'::jsonb
    AND intent->>'targetUserId'=target_user_id::text
    AND intent->>'expectedCellRevision'=target_pin->>'revision'
    AND intent->>'expectedConfigurationRevision' ~ '^[a-f0-9]{64}$'
    AND intent->>'configurationVersion' ~ '^[a-f0-9]{64}$'
    AND intent->>'entryId' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    AND jsonb_typeof(intent->'enabled')='boolean' AND intent->'confirmed'='true'::jsonb
    AND char_length(intent->>'reason') BETWEEN 3 AND 500
    AND ((intent->'enabled'='false'::jsonb AND intent->'expectedApprovalRevision'='null'::jsonb)
      OR (intent->'enabled'='true'::jsonb AND jsonb_typeof(intent->'expectedApprovalRevision')='number'
        AND intent->>'expectedApprovalRevision' ~ '^[1-9][0-9]{0,9}$'
        AND (intent->>'expectedApprovalRevision')::numeric<=2147483647)),false)),
  CHECK ((outcome='unconfirmed' AND confirmation IS NULL AND confirmed_at IS NULL)
    OR coalesce((outcome<>'unconfirmed' AND confirmation IS NOT NULL AND confirmed_at IS NOT NULL
      AND confirmation->>'commandId'=command_id::text AND confirmation->>'outcome'=outcome),false))
);
CREATE UNIQUE INDEX connector_activation_unconfirmed_target ON haas.connector_activation_commands(tenant_id,target_user_id) WHERE outcome='unconfirmed';
CREATE FUNCTION haas.guard_connector_activation_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    OLD.outcome<>'unconfirmed' OR NEW.outcome='unconfirmed'
    OR (to_jsonb(NEW)-ARRAY['outcome','confirmation','confirmed_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['outcome','confirmation','confirmed_at'])
  )) THEN RAISE EXCEPTION 'connector activation identity and terminal receipts are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER connector_activation_command_immutable BEFORE UPDATE OR DELETE ON haas.connector_activation_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_connector_activation_command();
