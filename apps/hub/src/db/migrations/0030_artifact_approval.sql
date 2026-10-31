CREATE TABLE "sb_artifact_approval" (
	"approval_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"tool" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_artifact_approval_approval_id_artifact_id_pk" PRIMARY KEY("approval_id","artifact_id")
);
--> statement-breakpoint
ALTER TABLE "sb_artifact_approval" ADD CONSTRAINT "sb_artifact_approval_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_artifact_approval" ADD CONSTRAINT "sb_artifact_approval_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_artifact_approval" ADD CONSTRAINT "sb_artifact_approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_artifact_approval_artifact_idx" ON "sb_artifact_approval" USING btree ("tenant_id","artifact_id","version");