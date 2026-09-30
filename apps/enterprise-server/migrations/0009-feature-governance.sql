-- Governance metadata and immutable command identity only. Native Settings,
-- installation state and execution journals retain their original owners.
CREATE TABLE haas.feature_approvals (
  tenant_id TEXT NOT NULL, user_id UUID NOT NULL,
  image_id TEXT NOT NULL CHECK (image_id ~ '^sha256:[a-f0-9]{64}$'),
  catalog_digest TEXT NOT NULL CHECK (catalog_digest ~ '^sha256:[a-f0-9]{64}$'),
  pack_ids JSONB NOT NULL CHECK (jsonb_typeof(pack_ids) = 'array' AND jsonb_array_length(pack_ids) <= 128),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reason TEXT NOT NULL, updated_by UUID NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES haas.users(tenant_id, user_id)
);
CREATE TABLE haas.feature_commands (
  tenant_id TEXT NOT NULL, command_id UUID NOT NULL, actor_user_id UUID NOT NULL,
  login_session_id UUID NOT NULL, idempotency_key UUID NOT NULL, request_digest TEXT NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  target_user_id UUID NOT NULL, input JSONB NOT NULL, target_pin JSONB NOT NULL, plan JSONB NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (outcome IN ('unconfirmed', 'applied', 'rolled-back')),
  confirmation JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), confirmed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, command_id), UNIQUE (tenant_id, actor_user_id, idempotency_key),
  FOREIGN KEY (tenant_id, actor_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, target_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, login_session_id) REFERENCES haas.login_sessions(tenant_id, session_id),
  CHECK (jsonb_typeof(input)='object' AND jsonb_typeof(target_pin)='object' AND jsonb_typeof(plan)='object'),
  CHECK ((outcome = 'unconfirmed' AND confirmation IS NULL AND confirmed_at IS NULL)
    OR coalesce((outcome <> 'unconfirmed' AND confirmation IS NOT NULL AND confirmed_at IS NOT NULL
      AND confirmation->>'phase'=outcome AND confirmation->>'commandId'=command_id::text
      AND confirmation->>'requestDigest'=request_digest AND confirmation->'plan'->>'planDigest'=plan->>'planDigest'), false))
);
CREATE UNIQUE INDEX feature_command_unconfirmed_target ON haas.feature_commands(tenant_id, target_user_id) WHERE outcome = 'unconfirmed';
CREATE FUNCTION haas.guard_feature_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (
    OLD.outcome <> 'unconfirmed' OR NEW.outcome = 'unconfirmed'
    OR (to_jsonb(NEW) - ARRAY['outcome','confirmation','confirmed_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['outcome','confirmation','confirmed_at'])
  )) THEN RAISE EXCEPTION 'feature command identity and terminal receipts are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER feature_command_immutable BEFORE UPDATE OR DELETE ON haas.feature_commands
  FOR EACH ROW EXECUTE FUNCTION haas.guard_feature_command();
