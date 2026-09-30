-- Control-plane intent is distinct from operator-observed enforcement. No
-- automatic backfill claims that existing containers have applied a policy.
CREATE TABLE haas.runtime_resource_policies (
  tenant_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  desired_state TEXT NOT NULL CHECK (desired_state IN ('running', 'suspended')),
  cpu_millis INTEGER NOT NULL CHECK (cpu_millis BETWEEN 100 AND 1000),
  memory_mib INTEGER NOT NULL CHECK (memory_mib BETWEEN 256 AND 1024),
  pids_limit INTEGER NOT NULL CHECK (pids_limit BETWEEN 32 AND 256),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  updated_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES haas.users (tenant_id, user_id),
  FOREIGN KEY (tenant_id, updated_by) REFERENCES haas.users (tenant_id, user_id)
);
ALTER TABLE haas.runtime_bindings
  ADD COLUMN resource_observation JSONB,
  ADD COLUMN resources_observed_at TIMESTAMPTZ,
  ADD CONSTRAINT runtime_resource_observation_pair CHECK (
    (resource_observation IS NULL) = (resources_observed_at IS NULL)
  );
-- All gateway admission reads use this view. A new policy immediately fences
-- stale observations, even before the operator's next per-cell renewal. The
-- underlying binding/lease and Docker resources remain operator-owned.
CREATE VIEW haas.admitted_runtime_bindings AS
  SELECT b.* FROM haas.runtime_bindings b
  LEFT JOIN haas.runtime_resource_policies p USING (tenant_id, user_id)
  WHERE p.user_id IS NULL OR (
    p.desired_state = 'running' AND b.resource_observation = jsonb_build_object(
      'revision', p.revision, 'desiredState', 'running', 'cpuMillis', p.cpu_millis,
      'memoryMiB', p.memory_mib, 'pidsLimit', p.pids_limit)
  );
