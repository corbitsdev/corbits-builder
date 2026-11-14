ALTER TABLE "sb_artifact_import_approval" ADD COLUMN "carried_from" integer;--> statement-breakpoint
ALTER TABLE "sb_artifact_import_approval" ADD COLUMN "request" text;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD COLUMN "request" text;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_requested_by_principal_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;