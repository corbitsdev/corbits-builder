CREATE TABLE "artifact_version" (
	"artifact_id" text NOT NULL,
	"version" bigint NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"media_type" text NOT NULL,
	"sha256" text NOT NULL,
	"produced_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_version_artifact_id_version_pk" PRIMARY KEY("artifact_id","version")
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"accepted" boolean NOT NULL,
	"principal_id" text NOT NULL,
	"artifact_id" text,
	"version" bigint,
	"sha256" text,
	"reason" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_revision_check" CHECK ("project"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sb_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"dependent_artifact_id" text NOT NULL,
	"dependent_version" bigint NOT NULL,
	"source_artifact_id" text NOT NULL,
	"source_version" bigint NOT NULL,
	"source_sha256" text NOT NULL,
	"locator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_edges_dependent_artifact_id_dependent_version_source_artifact_id_source_version_locator_unique" UNIQUE("dependent_artifact_id","dependent_version","source_artifact_id","source_version","locator")
);
--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_edges" ADD CONSTRAINT "sb_edges_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_edges" ADD CONSTRAINT "sb_edges_dependent_artifact_id_dependent_version_artifact_version_artifact_id_version_fk" FOREIGN KEY ("dependent_artifact_id","dependent_version") REFERENCES "public"."artifact_version"("artifact_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_edges_source_idx" ON "sb_edges" USING btree ("source_artifact_id","source_version");