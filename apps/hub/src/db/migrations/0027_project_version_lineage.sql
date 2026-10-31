CREATE TABLE "project_version_lineage" (
	"project_id" text PRIMARY KEY NOT NULL,
	"source_project_id" text NOT NULL,
	"source_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_version_lineage_revision_check" CHECK ("project_version_lineage"."source_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "project_version_lineage" ADD CONSTRAINT "project_version_lineage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_version_lineage" ADD CONSTRAINT "project_version_lineage_source_project_id_project_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_project_version_lineage_source_idx" ON "project_version_lineage" USING btree ("source_project_id");