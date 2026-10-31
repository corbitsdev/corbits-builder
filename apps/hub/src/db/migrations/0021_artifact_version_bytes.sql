CREATE TABLE "sb_artifact_version_bytes" (
	"project_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"version" bigint NOT NULL,
	"provider_artifact_id" text NOT NULL,
	"sha256" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"media_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"retained_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_artifact_version_bytes_project_id_artifact_id_version_pk" PRIMARY KEY("project_id","artifact_id","version"),
	CONSTRAINT "sb_artifact_version_bytes_version_check" CHECK ("sb_artifact_version_bytes"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "sb_artifact_version_bytes" ADD CONSTRAINT "sb_artifact_version_bytes_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Only bytes still present at migration time can be retained. Older metadata
-- does not manufacture a recoverable body; downloads verify the actual hash.
INSERT INTO "sb_artifact_version_bytes"
  (project_id, artifact_id, version, provider_artifact_id, sha256, kind, filename, media_type, content)
SELECT s.project_id, s.artifact_id, s.version, s.provider_artifact_id,
  v.sha256, s.kind, s.filename, s.media_type, s.content
FROM artifact_storage s JOIN artifact_version v
  ON v.project_id=s.project_id AND v.artifact_id=s.artifact_id AND v.version=s.version
WHERE s.content IS NOT NULL
ON CONFLICT DO NOTHING;
