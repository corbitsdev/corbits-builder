-- 0037's journal timestamp sorts before 0036's, so databases migrated past
-- 0036 skipped it. This reapplies 0037 so it is a no-op where it already ran.
CREATE TABLE IF NOT EXISTS "sb_approval_round" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"package_version" integer NOT NULL,
	"package_sha256" text NOT NULL,
	"started_by" text NOT NULL,
	"expiry_preset" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"reviewers" jsonb NOT NULL,
	"triage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"triggered_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sb_approval_round" ADD CONSTRAINT "sb_approval_round_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sb_approval_round" ADD CONSTRAINT "sb_approval_round_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sb_approval_round" ADD CONSTRAINT "sb_approval_round_started_by_principal_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sb_approval_round_project_idx" ON "sb_approval_round" USING btree ("tenant_id","project_id","created_at");
