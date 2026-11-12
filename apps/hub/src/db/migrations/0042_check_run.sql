CREATE TABLE "sb_check_run" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"plugin" text NOT NULL,
	"action" text NOT NULL,
	"input" jsonb NOT NULL,
	"versions" jsonb NOT NULL,
	"result" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"triggered_by" text NOT NULL,
	"skipped_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_check_run_result_check" CHECK ("sb_check_run"."result" in ('pass', 'fail', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_skipped_by_principal_id_fk" FOREIGN KEY ("skipped_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_check_run_project_idx" ON "sb_check_run" USING btree ("project_id","plugin","action","created_at");