CREATE TABLE haas.agent_publications (
  tenant_id TEXT NOT NULL,
  publication_id UUID NOT NULL,
  source_user_id UUID NOT NULL,
  preset_id TEXT NOT NULL,
  config_version TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  submission_reason TEXT NOT NULL,
  review_reason TEXT,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, publication_id),
  UNIQUE (tenant_id, source_user_id, preset_id, config_version),
  FOREIGN KEY (tenant_id, source_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES haas.users(tenant_id, user_id)
);

CREATE FUNCTION haas.protect_publication_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.publication_id, NEW.source_user_id, NEW.preset_id, NEW.config_version,
    NEW.content_digest, NEW.snapshot, NEW.submission_reason, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.publication_id, OLD.source_user_id, OLD.preset_id, OLD.config_version,
    OLD.content_digest, OLD.snapshot, OLD.submission_reason, OLD.created_at) THEN
    RAISE EXCEPTION 'publication content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_content_immutable BEFORE UPDATE ON haas.agent_publications
  FOR EACH ROW EXECUTE FUNCTION haas.protect_publication_content();

CREATE TABLE haas.resource_assignments (
  tenant_id TEXT NOT NULL,
  publication_id UUID NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user', 'group', 'all')),
  subject_user_id UUID,
  subject_group_id UUID,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK ((subject_kind = 'user' AND subject_user_id IS NOT NULL AND subject_group_id IS NULL)
    OR (subject_kind = 'group' AND subject_group_id IS NOT NULL AND subject_user_id IS NULL)
    OR (subject_kind = 'all' AND subject_user_id IS NULL AND subject_group_id IS NULL)),
  CHECK (effect <> 'deny' OR subject_kind = 'user'),
  UNIQUE NULLS NOT DISTINCT (tenant_id, publication_id, subject_kind, subject_user_id, subject_group_id),
  FOREIGN KEY (tenant_id, publication_id) REFERENCES haas.agent_publications(tenant_id, publication_id),
  FOREIGN KEY (tenant_id, subject_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, subject_group_id) REFERENCES haas.member_groups(tenant_id, group_id)
);
