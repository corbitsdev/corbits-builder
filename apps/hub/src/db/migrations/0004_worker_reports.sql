CREATE TABLE "owner_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text NOT NULL,
	"task_revision" bigint NOT NULL,
	"worker_run_id" text NOT NULL,
	"coordinator_run_id" text NOT NULL,
	"deliverable_id" text NOT NULL,
	"report_id" text NOT NULL,
	"packet" jsonb NOT NULL,
	"packet_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_assignment_report_id_unique" UNIQUE("report_id"),
	CONSTRAINT "owner_assignment_project_id_task_id_task_revision_unique" UNIQUE("project_id","task_id","task_revision"),
	CONSTRAINT "owner_assignment_revision_check" CHECK ("owner_assignment"."task_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "worker_report" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"report" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filed_revision" bigint,
	"filed_result" text,
	"filed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "owner_assignment" ADD CONSTRAINT "owner_assignment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_assignment" ADD CONSTRAINT "owner_assignment_worker_run_id_workflow_run_id_fk" FOREIGN KEY ("worker_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_assignment" ADD CONSTRAINT "owner_assignment_coordinator_run_id_workflow_run_id_fk" FOREIGN KEY ("coordinator_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_report" ADD CONSTRAINT "worker_report_assignment_id_owner_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."owner_assignment"("id") ON DELETE no action ON UPDATE no action;