-- Durable explicit administrator requests, not a runtime registry. Application
-- role can only insert; the existing trusted operator owns claim/outcome.
CREATE TABLE haas.runtime_recovery_requests (
  tenant_id TEXT NOT NULL,
  request_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  login_session_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  target_pin JSONB NOT NULL CHECK (jsonb_typeof(target_pin)='object'),
  resource_policy JSONB NOT NULL CHECK (jsonb_typeof(resource_policy)='object'),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  outcome TEXT NOT NULL DEFAULT 'queued' CHECK (outcome IN ('queued','executing','applied','rejected','unconfirmed')),
  claim_id UUID,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id,request_id),
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES haas.users(tenant_id,user_id),
  FOREIGN KEY (tenant_id,target_user_id) REFERENCES haas.users(tenant_id,user_id),
  FOREIGN KEY (tenant_id,login_session_id) REFERENCES haas.login_sessions(tenant_id,session_id),
  CHECK ((outcome='queued' AND claim_id IS NULL AND claimed_at IS NULL AND result IS NULL AND finished_at IS NULL)
    OR (outcome='executing' AND claim_id IS NOT NULL AND claimed_at IS NOT NULL AND result IS NULL AND finished_at IS NULL)
    OR (outcome='rejected' AND claim_id IS NULL AND claimed_at IS NULL AND result IS NOT NULL AND finished_at IS NOT NULL)
    OR (outcome IN ('applied','unconfirmed') AND claim_id IS NOT NULL AND claimed_at IS NOT NULL AND result IS NOT NULL AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX runtime_recovery_open_target ON haas.runtime_recovery_requests(tenant_id,target_user_id)
  WHERE outcome IN ('queued','executing','unconfirmed');
CREATE FUNCTION haas.guard_runtime_recovery_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (
    (OLD.outcome='queued' AND NEW.outcome NOT IN ('executing','rejected'))
    OR (OLD.outcome='executing' AND (NEW.outcome NOT IN ('applied','unconfirmed') OR NEW.claim_id<>OLD.claim_id OR NEW.claimed_at<>OLD.claimed_at))
    OR OLD.outcome NOT IN ('queued','executing')
    OR (to_jsonb(NEW)-ARRAY['outcome','claim_id','claimed_at','result','finished_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['outcome','claim_id','claimed_at','result','finished_at'])
  )) THEN RAISE EXCEPTION 'runtime recovery identity and terminal receipts are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runtime_recovery_request_immutable BEFORE UPDATE OR DELETE ON haas.runtime_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION haas.guard_runtime_recovery_request();
