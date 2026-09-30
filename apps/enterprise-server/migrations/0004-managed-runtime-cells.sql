-- Operator-owned immutable container identity. Development process rows remain
-- explicitly distinct and never become member admission by adding an origin.
ALTER TABLE haas.runtime_bindings
  DROP CONSTRAINT runtime_bindings_isolation_mode_check,
  ADD COLUMN container_id TEXT UNIQUE,
  ADD COLUMN image_id TEXT,
  ADD COLUMN volume_name TEXT UNIQUE,
  ADD COLUMN policy_digest TEXT,
  ADD CONSTRAINT runtime_bindings_managed_identity_check CHECK (
    (isolation_mode = 'development-process' AND container_id IS NULL AND image_id IS NULL
      AND volume_name IS NULL AND policy_digest IS NULL)
    OR
    (isolation_mode = 'container-managed' AND container_id IS NOT NULL AND image_id IS NOT NULL
      AND volume_name IS NOT NULL AND policy_digest IS NOT NULL
      AND container_id ~ '^[a-f0-9]{64}$'
      AND image_id ~ '^sha256:[a-f0-9]{64}$'
      AND volume_name ~ '^paimind-haas-member-[a-z0-9-]{1,100}$'
      AND policy_digest ~ '^sha256:[a-f0-9]{64}$')
  );
-- Existing application SELECT privileges include the new columns; the app
-- still has no INSERT/UPDATE/DELETE privilege on runtime_bindings.
