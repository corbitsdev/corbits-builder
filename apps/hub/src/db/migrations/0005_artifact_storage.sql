CREATE TABLE "artifact_storage" (
	"artifact_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider_artifact_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" bigint NOT NULL,
	"content" "bytea",
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	CONSTRAINT "artifact_storage_provider_artifact_id_unique" UNIQUE("provider_artifact_id"),
	CONSTRAINT "artifact_storage_version_check" CHECK ("artifact_storage"."version">0)
);
--> statement-breakpoint
ALTER TABLE "artifact_storage" ADD CONSTRAINT "artifact_storage_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;