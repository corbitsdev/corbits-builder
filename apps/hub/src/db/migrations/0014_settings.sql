CREATE TABLE "sb_settings" (
	"tenant_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"project_id" text,
	"fields" jsonb NOT NULL,
	CONSTRAINT "sb_settings_tenant_id_scope_key_pk" PRIMARY KEY("tenant_id","scope_key")
);
--> statement-breakpoint
ALTER TABLE "sb_settings" ADD CONSTRAINT "sb_settings_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_settings" ADD CONSTRAINT "sb_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;