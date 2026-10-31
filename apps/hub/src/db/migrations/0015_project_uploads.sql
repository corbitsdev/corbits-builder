CREATE TABLE "sb_project_upload" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"project_id" text NOT NULL,
	"anchor_run_id" text NOT NULL,
	"sender_principal_id" text NOT NULL,
	"message_id" text NOT NULL,
	"attachment_index" bigint NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"disclosure" jsonb NOT NULL,
	"extracted_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_project_upload_anchor_run_id_message_id_attachment_index_unique" UNIQUE("anchor_run_id","message_id","attachment_index"),
	CONSTRAINT "sb_project_upload_version_check" CHECK ("sb_project_upload"."version"=1),
	CONSTRAINT "sb_project_upload_index_check" CHECK ("sb_project_upload"."attachment_index">=0)
);
--> statement-breakpoint
ALTER TABLE "sb_project_upload" ADD CONSTRAINT "sb_project_upload_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_project_upload" ADD CONSTRAINT "sb_project_upload_anchor_run_id_workflow_run_id_fk" FOREIGN KEY ("anchor_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_project_upload" ADD CONSTRAINT "sb_project_upload_sender_principal_id_principal_id_fk" FOREIGN KEY ("sender_principal_id") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_project_upload" ADD CONSTRAINT "sb_project_upload_artifact_id_version_artifact_version_artifact_id_version_fk" FOREIGN KEY ("artifact_id","version") REFERENCES "public"."artifact_version"("artifact_id","version") ON DELETE no action ON UPDATE no action;