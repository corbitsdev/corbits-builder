CREATE TABLE "sb_ended_run" (
	"run_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"notified" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sb_ended_run" ADD CONSTRAINT "sb_ended_run_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_ended_run" ADD CONSTRAINT "sb_ended_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "sb_ended_run" ("run_id", "project_id", "notified")
SELECT "workflow_run"."id", "project"."id", false
FROM "workflow_run" JOIN "project" ON "project"."tenant_id" = "workflow_run"."tenant_id"
WHERE "workflow_run"."status" IN ('failed', 'cancelled');
