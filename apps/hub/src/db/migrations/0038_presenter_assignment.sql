CREATE TABLE "sb_presenter_assignment" (
	"run_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"assignment" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sb_presenter_assignment" ADD CONSTRAINT "sb_presenter_assignment_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_presenter_assignment" ADD CONSTRAINT "sb_presenter_assignment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_presenter_assignment" ADD CONSTRAINT "sb_presenter_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Assignments recorded before this table lived in sb_settings; one missing a field a filing now
-- requires cannot be filed against, so only complete ones move.
INSERT INTO "sb_presenter_assignment" ("run_id", "tenant_id", "project_id", "assignment")
SELECT "run"."id", "s"."tenant_id", "s"."project_id",
  jsonb_build_object(
    'audience', "s"."fields"->'assignment'->'audience',
    'personaLabel', "s"."fields"->'assignment'->'personaLabel',
    'decisionNeeded', "s"."fields"->'assignment'->'decisionNeeded',
    'tone', "s"."fields"->'assignment'->'tone',
    'length', "s"."fields"->'assignment'->'length',
    'sources', "s"."fields"->'assignment'->'sources'
  )
FROM "sb_settings" "s"
JOIN "workflow_run" "run" ON "run"."id" = substr("s"."scope_key", length('presenter:') + 1)
WHERE "s"."scope_key" LIKE 'presenter:%'
  AND "s"."project_id" IS NOT NULL
  AND "s"."fields"->'assignment' ?& array['audience', 'personaLabel', 'decisionNeeded', 'tone', 'length', 'sources'];--> statement-breakpoint
DELETE FROM "sb_settings" WHERE "scope_key" LIKE 'presenter:%';
