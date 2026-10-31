CREATE TABLE "sb_upload_classification" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"created_by" text NOT NULL,
	"run_id" text,
	"read_receipt_id" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sb_upload_read_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"run_id" text,
	"extracted_sha256" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sb_upload_route" (
	"proposal_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"target_artifact_id" text NOT NULL,
	"target_version" bigint NOT NULL,
	"target_sha256" text NOT NULL,
	"accepted_by" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_upload_route_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_upload_id_sb_project_upload_artifact_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."sb_project_upload"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_created_by_principal_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_read_receipt_id_sb_upload_read_receipt_id_fk" FOREIGN KEY ("read_receipt_id") REFERENCES "public"."sb_upload_read_receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" ADD CONSTRAINT "sb_upload_classification_accepted_by_principal_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_read_receipt" ADD CONSTRAINT "sb_upload_read_receipt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_read_receipt" ADD CONSTRAINT "sb_upload_read_receipt_upload_id_sb_project_upload_artifact_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."sb_project_upload"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_read_receipt" ADD CONSTRAINT "sb_upload_read_receipt_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_read_receipt" ADD CONSTRAINT "sb_upload_read_receipt_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_route" ADD CONSTRAINT "sb_upload_route_proposal_id_sb_upload_classification_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."sb_upload_classification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_route" ADD CONSTRAINT "sb_upload_route_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_route" ADD CONSTRAINT "sb_upload_route_upload_id_sb_project_upload_artifact_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."sb_project_upload"("artifact_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_route" ADD CONSTRAINT "sb_upload_route_accepted_by_principal_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_upload_route" ADD CONSTRAINT "sb_upload_route_target_artifact_id_target_version_artifact_version_artifact_id_version_fk" FOREIGN KEY ("target_artifact_id","target_version") REFERENCES "public"."artifact_version"("artifact_id","version") ON DELETE no action ON UPDATE no action;