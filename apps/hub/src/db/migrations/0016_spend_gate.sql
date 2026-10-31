CREATE TABLE "sb_spend_authorization" (
	"project_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"version" bigint NOT NULL,
	"authorized_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"plan_sha256" text NOT NULL,
	"settings_sha256" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_spend_authorization_project_id_version_pk" PRIMARY KEY("project_id","version"),
	CONSTRAINT "sb_spend_authorization_tenant_id_authorized_by_idempotency_key_unique" UNIQUE("tenant_id","authorized_by","idempotency_key"),
	CONSTRAINT "sb_spend_auth_version_check" CHECK ("sb_spend_authorization"."version">0)
);
--> statement-breakpoint
CREATE TABLE "sb_spend_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"task_id" text,
	"authorization_version" bigint NOT NULL,
	"request_sha256" text NOT NULL,
	"reserved_nano" bigint NOT NULL,
	"settled_upper_bound_nano" bigint,
	"pricing_snapshot" jsonb NOT NULL,
	"usage" jsonb,
	"provider_response_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "sb_spend_reservation_amount_check" CHECK ("sb_spend_reservation"."reserved_nano">=0 AND ("sb_spend_reservation"."settled_upper_bound_nano" IS NULL OR "sb_spend_reservation"."settled_upper_bound_nano">=0)),
	CONSTRAINT "sb_spend_reservation_status_check" CHECK ("sb_spend_reservation"."status" IN ('reserved','settled','unknown'))
);
--> statement-breakpoint
ALTER TABLE "sb_spend_authorization" ADD CONSTRAINT "sb_spend_authorization_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_authorization" ADD CONSTRAINT "sb_spend_authorization_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_authorization" ADD CONSTRAINT "sb_spend_authorization_authorized_by_principal_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_reservation" ADD CONSTRAINT "sb_spend_reservation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_reservation" ADD CONSTRAINT "sb_spend_reservation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_reservation" ADD CONSTRAINT "sb_spend_reservation_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_spend_reservation" ADD CONSTRAINT "sb_spend_reservation_project_id_authorization_version_sb_spend_authorization_project_id_version_fk" FOREIGN KEY ("project_id","authorization_version") REFERENCES "public"."sb_spend_authorization"("project_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_spend_project_idx" ON "sb_spend_reservation" USING btree ("tenant_id","project_id");