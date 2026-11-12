CREATE TABLE "sb_run_action" (
	"run_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"plugin" text NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "routes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_run_action_project_idx" ON "sb_run_action" USING btree ("project_id");--> statement-breakpoint
UPDATE "project" SET "routes" = ARRAY["route"] WHERE "route" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "route";