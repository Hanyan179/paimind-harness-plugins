CREATE SCHEMA haas;

CREATE TABLE haas.tenants (
  tenant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE haas.users (
  tenant_id TEXT NOT NULL REFERENCES haas.tenants(tenant_id),
  user_id UUID NOT NULL,
  username TEXT NOT NULL CHECK (username = lower(username)),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  credential TEXT NOT NULL CHECK (credential LIKE 'scrypt-v1$%'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, username)
);

CREATE TABLE haas.login_sessions (
  tenant_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES haas.users(tenant_id, user_id)
);
CREATE INDEX login_sessions_user ON haas.login_sessions(tenant_id, user_id);

CREATE TABLE haas.command_receipts (
  tenant_id TEXT NOT NULL REFERENCES haas.tenants(tenant_id),
  scope TEXT NOT NULL,
  idempotency_key UUID NOT NULL,
  request_digest TEXT NOT NULL,
  operation_id UUID NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, scope, idempotency_key)
);

CREATE TABLE haas.audit_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES haas.tenants(tenant_id),
  actor_user_id UUID,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  request_id UUID NOT NULL,
  target_id UUID,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_events_tenant ON haas.audit_events(tenant_id, sequence DESC);

CREATE FUNCTION haas.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append only';
END;
$$;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON haas.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION haas.reject_audit_mutation();

CREATE TABLE haas.auth_buckets (
  tenant_id TEXT NOT NULL REFERENCES haas.tenants(tenant_id),
  subject_digest TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (tenant_id, subject_digest)
);
