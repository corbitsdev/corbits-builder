CREATE TABLE "sb_artifact_import_approval" (
	"artifact_id" text NOT NULL,
	"version" integer NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"kind" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_artifact_import_approval_artifact_id_version_pk" PRIMARY KEY("artifact_id","version")
);
--> statement-breakpoint
ALTER TABLE "sb_artifact_import_approval" ADD CONSTRAINT "sb_artifact_import_approval_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_artifact_import_approval" ADD CONSTRAINT "sb_artifact_import_approval_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_artifact_import_approval" ADD CONSTRAINT "sb_artifact_import_approval_principal_id_principal_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_artifact_import_approval_tenant_idx" ON "sb_artifact_import_approval" USING btree ("tenant_id","artifact_id");