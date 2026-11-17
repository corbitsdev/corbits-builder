CREATE TABLE "sb_answered_question" (
	"project_id" text NOT NULL,
	"signal_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_answered_question_project_id_signal_name_pk" PRIMARY KEY("project_id","signal_name")
);
--> statement-breakpoint
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
CREATE TABLE "sb_run_action" (
	"run_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"plugin" text NOT NULL,
	"action" text NOT NULL,
	"plan_step" text,
	"record" jsonb,
	"blocked" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "following" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "sb_answered_question" ADD CONSTRAINT "sb_answered_question_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_check_run" ADD CONSTRAINT "sb_check_run_skipped_by_principal_id_fk" FOREIGN KEY ("skipped_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_run_action" ADD CONSTRAINT "sb_run_action_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_check_run_project_idx" ON "sb_check_run" USING btree ("project_id","plugin","action","created_at");--> statement-breakpoint
CREATE INDEX "sb_run_action_project_idx" ON "sb_run_action" USING btree ("project_id");