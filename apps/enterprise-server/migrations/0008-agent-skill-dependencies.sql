-- Governance edges only. Native Agent snapshots, Skill bytes and user choices
-- retain their original owners. Existing immutable publications are not edited.
CREATE TABLE haas.agent_skill_dependencies (
  tenant_id TEXT NOT NULL,
  publication_id UUID NOT NULL,
  skill_name TEXT NOT NULL,
  skill_publication_id UUID NOT NULL,
  PRIMARY KEY (tenant_id, publication_id, skill_name),
  UNIQUE (tenant_id, publication_id, skill_publication_id),
  FOREIGN KEY (tenant_id, publication_id) REFERENCES haas.agent_publications(tenant_id, publication_id),
  FOREIGN KEY (tenant_id, skill_publication_id) REFERENCES haas.skill_publications(tenant_id, publication_id)
);

CREATE FUNCTION haas.guard_agent_skill_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  agent_row haas.agent_publications%ROWTYPE;
  skill_row haas.skill_publications%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'agent skill dependency is immutable'; END IF;
  SELECT * INTO agent_row FROM haas.agent_publications
    WHERE tenant_id = NEW.tenant_id AND publication_id = NEW.publication_id FOR SHARE;
  SELECT * INTO skill_row FROM haas.skill_publications
    WHERE tenant_id = NEW.tenant_id AND publication_id = NEW.skill_publication_id FOR SHARE;
  IF agent_row.status IS DISTINCT FROM 'pending' OR skill_row.status IS DISTINCT FROM 'published'
    OR skill_row.skill_name IS DISTINCT FROM NEW.skill_name
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(agent_row.snapshot->'content'->'dependencies') dependency
      WHERE dependency->>'name' = NEW.skill_name AND dependency->>'digest' = skill_row.package_digest) THEN
    RAISE EXCEPTION 'agent skill dependency must select the exact approved version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_skill_dependency_immutable BEFORE INSERT OR UPDATE OR DELETE ON haas.agent_skill_dependencies
  FOR EACH ROW EXECUTE FUNCTION haas.guard_agent_skill_dependency();

CREATE FUNCTION haas.guard_agent_publication_dependencies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND (
    (SELECT count(*) FROM haas.agent_skill_dependencies edge
      WHERE edge.tenant_id = NEW.tenant_id AND edge.publication_id = NEW.publication_id)
      <> jsonb_array_length(NEW.snapshot->'content'->'dependencies')
    OR EXISTS (SELECT 1 FROM haas.agent_skill_dependencies edge
      JOIN haas.skill_publications skill ON skill.tenant_id = edge.tenant_id AND skill.publication_id = edge.skill_publication_id
      WHERE edge.tenant_id = NEW.tenant_id AND edge.publication_id = NEW.publication_id
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.snapshot->'content'->'dependencies') dependency
          WHERE dependency->>'name' = edge.skill_name AND dependency->>'digest' = skill.package_digest))
  ) THEN RAISE EXCEPTION 'published agent requires complete immutable skill dependencies'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_publication_dependency_floor BEFORE INSERT OR UPDATE OF status ON haas.agent_publications
  FOR EACH ROW EXECUTE FUNCTION haas.guard_agent_publication_dependencies();
