-- Governance archives only. The original Skill owner retains its editable
-- repository and native runtime. No online automatic migration or cleanup.
CREATE TABLE haas.skill_artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  source_user_id UUID NOT NULL,
  submission_key UUID NOT NULL,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[A-Za-z0-9_-]{43}$'),
  skill_name TEXT NOT NULL CHECK (skill_name ~ '^[a-z0-9][a-z0-9-]{0,254}$'),
  package_digest TEXT NOT NULL CHECK (package_digest ~ '^sha256:[a-f0-9]{64}$'),
  capture_generation UUID NOT NULL,
  capture_deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'sealed')),
  next_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_offset BETWEEN 0 AND 226492416),
  archive_digest TEXT CHECK (archive_digest ~ '^sha256:[a-f0-9]{64}$'),
  archive_bytes INTEGER CHECK (archive_bytes BETWEEN 1 AND 226492416),
  expanded_bytes INTEGER CHECK (expanded_bytes BETWEEN 1 AND 209715200),
  entry_count INTEGER CHECK (entry_count BETWEEN 1 AND 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  sealed_at TIMESTAMPTZ,
  CHECK ((status = 'staging' AND archive_digest IS NULL AND archive_bytes IS NULL
    AND expanded_bytes IS NULL AND entry_count IS NULL AND sealed_at IS NULL)
    OR (status = 'sealed' AND archive_digest IS NOT NULL AND archive_bytes IS NOT NULL
    AND expanded_bytes IS NOT NULL AND entry_count IS NOT NULL AND sealed_at IS NOT NULL AND next_offset = archive_bytes)),
  PRIMARY KEY (tenant_id, artifact_id),
  UNIQUE (tenant_id, source_user_id, submission_key),
  UNIQUE (tenant_id, artifact_id, source_user_id, skill_name, package_digest),
  FOREIGN KEY (tenant_id, source_user_id) REFERENCES haas.users(tenant_id, user_id)
);

CREATE TABLE haas.skill_artifact_chunks (
  tenant_id TEXT NOT NULL,
  artifact_id UUID NOT NULL,
  chunk_offset INTEGER NOT NULL CHECK (chunk_offset >= 0 AND chunk_offset < 226492416 AND chunk_offset % 98304 = 0),
  data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 98304),
  PRIMARY KEY (tenant_id, artifact_id, chunk_offset),
  FOREIGN KEY (tenant_id, artifact_id) REFERENCES haas.skill_artifacts(tenant_id, artifact_id)
);

CREATE FUNCTION haas.protect_skill_artifact_chunks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'skill chunks cannot be edited'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO parent_status FROM haas.skill_artifacts
      WHERE tenant_id = NEW.tenant_id AND artifact_id = NEW.artifact_id FOR UPDATE;
  ELSE
    SELECT status INTO parent_status FROM haas.skill_artifacts
      WHERE tenant_id = OLD.tenant_id AND artifact_id = OLD.artifact_id FOR UPDATE;
  END IF;
  IF parent_status IS DISTINCT FROM 'staging' THEN RAISE EXCEPTION 'sealed skill chunks are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER skill_artifact_chunks_guard BEFORE INSERT OR UPDATE OR DELETE ON haas.skill_artifact_chunks
  FOR EACH ROW EXECUTE FUNCTION haas.protect_skill_artifact_chunks();

CREATE FUNCTION haas.protect_skill_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; chunks BIGINT; first_offset INTEGER; last_offset INTEGER; malformed BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'staging' OR NEW.next_offset <> 0 THEN RAISE EXCEPTION 'skill archive must begin with empty staging'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'sealed' THEN RAISE EXCEPTION 'sealed skill archive is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'sealed' OR ROW(NEW.tenant_id, NEW.artifact_id, NEW.source_user_id, NEW.submission_key,
    NEW.request_digest, NEW.skill_name, NEW.package_digest, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.artifact_id, OLD.source_user_id, OLD.submission_key,
    OLD.request_digest, OLD.skill_name, OLD.package_digest, OLD.created_at) THEN
    RAISE EXCEPTION 'skill archive identity and sealed content are immutable';
  END IF;
  IF NEW.status = 'sealed' THEN
    IF NEW.capture_generation <> OLD.capture_generation OR OLD.capture_deadline <= clock_timestamp() THEN
      RAISE EXCEPTION 'skill capture expired or changed';
    END IF;
    SELECT sum(octet_length(data)), count(*), min(chunk_offset), max(chunk_offset),
      count(*) FILTER (WHERE octet_length(data) <> least(98304, NEW.archive_bytes - chunk_offset))
      INTO total, chunks, first_offset, last_offset, malformed FROM haas.skill_artifact_chunks
      WHERE tenant_id = NEW.tenant_id AND artifact_id = NEW.artifact_id;
    IF total IS DISTINCT FROM NEW.archive_bytes::bigint OR first_offset IS DISTINCT FROM 0
      OR chunks IS DISTINCT FROM ceil(NEW.archive_bytes::numeric / 98304)::bigint
      OR last_offset IS DISTINCT FROM ((NEW.archive_bytes - 1) / 98304) * 98304 OR malformed <> 0 THEN
      RAISE EXCEPTION 'skill archive is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER skill_artifact_guard BEFORE INSERT OR UPDATE OR DELETE ON haas.skill_artifacts
  FOR EACH ROW EXECUTE FUNCTION haas.protect_skill_artifact();

CREATE TABLE haas.skill_publications (
  tenant_id TEXT NOT NULL,
  publication_id UUID NOT NULL,
  source_user_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  skill_name TEXT NOT NULL,
  package_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'withdrawn')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  submission_reason TEXT NOT NULL,
  review_reason TEXT,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reviewed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, publication_id),
  UNIQUE (tenant_id, artifact_id),
  FOREIGN KEY (tenant_id, artifact_id, source_user_id, skill_name, package_digest)
    REFERENCES haas.skill_artifacts(tenant_id, artifact_id, source_user_id, skill_name, package_digest),
  FOREIGN KEY (tenant_id, reviewed_by) REFERENCES haas.users(tenant_id, user_id)
);

CREATE FUNCTION haas.protect_skill_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'skill publication history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM haas.skill_artifacts WHERE tenant_id = NEW.tenant_id AND artifact_id = NEW.artifact_id AND status = 'sealed' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'skill publication requires a sealed archive'; END IF;
  ELSIF ROW(NEW.tenant_id, NEW.publication_id, NEW.source_user_id, NEW.artifact_id,
    NEW.skill_name, NEW.package_digest, NEW.submission_reason, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id, OLD.publication_id, OLD.source_user_id, OLD.artifact_id,
    OLD.skill_name, OLD.package_digest, OLD.submission_reason, OLD.created_at) THEN
    RAISE EXCEPTION 'skill publication content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER skill_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON haas.skill_publications
  FOR EACH ROW EXECUTE FUNCTION haas.protect_skill_publication();

CREATE FUNCTION haas.reject_skill_archive_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'skill publication history cannot be truncated'; END;
$$;
CREATE TRIGGER skill_artifact_no_truncate BEFORE TRUNCATE ON haas.skill_artifacts
  EXECUTE FUNCTION haas.reject_skill_archive_truncate();
CREATE TRIGGER skill_chunk_no_truncate BEFORE TRUNCATE ON haas.skill_artifact_chunks
  EXECUTE FUNCTION haas.reject_skill_archive_truncate();
CREATE TRIGGER skill_publication_no_truncate BEFORE TRUNCATE ON haas.skill_publications
  EXECUTE FUNCTION haas.reject_skill_archive_truncate();

CREATE TABLE haas.skill_assignments (
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
  FOREIGN KEY (tenant_id, publication_id) REFERENCES haas.skill_publications(tenant_id, publication_id),
  FOREIGN KEY (tenant_id, subject_user_id) REFERENCES haas.users(tenant_id, user_id),
  FOREIGN KEY (tenant_id, subject_group_id) REFERENCES haas.member_groups(tenant_id, group_id)
);
