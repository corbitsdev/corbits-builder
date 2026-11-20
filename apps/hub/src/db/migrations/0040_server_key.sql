CREATE TABLE "sb_server_key" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"issuer" text NOT NULL,
	"stage" text NOT NULL,
	"public_key" text NOT NULL,
	"sealed_private_key" text,
	"label" text NOT NULL,
	"bound_host" text,
	"bound_port" integer,
	"host_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bound_at" timestamp with time zone,
	CONSTRAINT "sb_server_key_tenant_name" UNIQUE("tenant_id","name"),
	CONSTRAINT "sb_server_key_stage_check" CHECK ("sb_server_key"."stage" in ('issued', 'bound')),
	CONSTRAINT "sb_server_key_stage_fields_check" CHECK (("sb_server_key"."stage" = 'issued' and "sb_server_key"."sealed_private_key" is not null and "sb_server_key"."bound_host" is null and "sb_server_key"."bound_port" is null and "sb_server_key"."host_key" is null and "sb_server_key"."bound_at" is null) or ("sb_server_key"."stage" = 'bound' and "sb_server_key"."sealed_private_key" is null and "sb_server_key"."bound_host" is not null and "sb_server_key"."bound_port" is not null and "sb_server_key"."host_key" is not null and "sb_server_key"."bound_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sb_server_key" ADD CONSTRAINT "sb_server_key_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_server_key" ADD CONSTRAINT "sb_server_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;