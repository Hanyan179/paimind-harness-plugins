-- Provisioner-owned bindings, not browser-selected destinations. Runtime API
-- role receives SELECT only. A process fixture is explicitly not a production
-- isolation claim; container admission and image attestations remain separate.
CREATE TABLE haas.runtime_bindings (
  cell_id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  origin TEXT NOT NULL UNIQUE,
  revision UUID NOT NULL,
  isolation_mode TEXT NOT NULL CHECK (isolation_mode = 'development-process'),
  status TEXT NOT NULL CHECK (status IN ('ready', 'suspended')),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES haas.users(tenant_id, user_id)
);
