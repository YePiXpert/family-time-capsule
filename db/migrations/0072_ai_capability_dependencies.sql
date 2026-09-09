-- Each capability has its own receiver (e.g. MiMo audio feeding CPA text).
-- Keep same-capability routing, family, actor, externality and cycle guards.
-- Application enqueue/claim rechecks both receivers, consents and source subsets.
DROP TRIGGER ai_job_dependency_insert_guard;
--> statement-breakpoint
CREATE TRIGGER ai_job_dependency_insert_guard
BEFORE INSERT ON ai_job_dependency
WHEN NOT EXISTS (
  SELECT 1 FROM ai_job child JOIN ai_job parent ON parent.id = NEW.depends_on_job_id
  WHERE child.id = NEW.job_id AND child.status = 'pending' AND child.attempts = 0
    AND child.family_id = parent.family_id
    AND child.requested_by_user_id = parent.requested_by_user_id
    AND (child.required_capability <> parent.required_capability
      OR (child.configuration_id = parent.configuration_id AND child.provider_id = parent.provider_id))
    AND child.provider_external = parent.provider_external
) OR EXISTS (
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.depends_on_job_id UNION
    SELECT d.depends_on_job_id FROM ai_job_dependency d JOIN ancestors a ON d.job_id = a.id
  ) SELECT 1 FROM ancestors WHERE id = NEW.job_id
)
BEGIN SELECT RAISE(ABORT, 'invalid AI dependency'); END;
