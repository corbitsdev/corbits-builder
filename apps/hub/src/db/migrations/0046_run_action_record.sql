ALTER TABLE "sb_run_action" ADD COLUMN "record" jsonb;
--> statement-breakpoint
-- A starter kept its run's record in sb_settings under "<plugin>:<run id>" before runs had a record
-- of their own; each is copied onto its run, and the settings rows stay.
UPDATE "sb_run_action" r SET "record" = s.fields
FROM "sb_settings" s
WHERE s.tenant_id = r.tenant_id AND s.scope_key = r.plugin || ':' || r.run_id;
