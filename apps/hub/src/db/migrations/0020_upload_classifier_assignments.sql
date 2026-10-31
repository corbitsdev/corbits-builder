CREATE TABLE "sb_upload_classifier_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"worker_run_id" text NOT NULL,
	"coordinator_run_id" text NOT NULL,
	"packet" jsonb NOT NULL,
	"packet_sha256" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_upload_classifier_assignment_worker_run_id_unique" UNIQUE("worker_run_id")
);
--> statement-breakpoint
ALTER TABLE "sb_upload_classifier_assignment" ADD CONSTRAINT "sb_upload_classifier_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classifier_assignment" ADD CONSTRAINT "sb_upload_classifier_assignment_upload_id_sb_project_upload_artifact_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."sb_project_upload"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classifier_assignment" ADD CONSTRAINT "sb_upload_classifier_assignment_worker_run_id_workflow_run_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classifier_assignment" ADD CONSTRAINT "sb_upload_classifier_assignment_coordinator_run_id_workflow_run_id_fk" FOREIGN KEY ("coordinator_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;