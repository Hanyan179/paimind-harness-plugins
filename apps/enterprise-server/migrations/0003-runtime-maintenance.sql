-- Operator-owned maintenance receipts. The application/gateway role must not
-- insert, update or delete these rows, even though it can write user commands.
-- This table records runtime control, never native Workspace/Session content.
CREATE TABLE haas.runtime_maintenance (
  operation_id UUID PRIMARY KEY,
  cell_id UUID NOT NULL REFERENCES haas.runtime_bindings(cell_id),
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  previous_revision UUID NOT NULL,
  fenced_revision UUID NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  reason TEXT NOT NULL CHECK (reason IN ('maintenance', 'storage-recovery', 'image-change')),
  request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES haas.users(tenant_id, user_id)
);
