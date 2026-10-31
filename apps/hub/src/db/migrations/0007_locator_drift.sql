ALTER TABLE "sb_edges" ADD COLUMN "locator_drift_reason" text;
--> statement-breakpoint
-- Intermediate bodies were intentionally not retained before this migration.
-- A current match cannot prove that an older fingerprint never disappeared.
UPDATE "sb_edges" e SET "locator_drift_reason" = 'history_unavailable'
WHERE e.locator IS NOT NULL AND e.source_version IS DISTINCT FROM (
  SELECT max(v.version) FROM artifact_version v WHERE v.project_id=e.project_id
    AND v.artifact_id=e.source_artifact_id
);
