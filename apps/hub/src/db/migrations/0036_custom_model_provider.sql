CREATE TABLE "sb_custom_model_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"model_provider_id" text NOT NULL,
	"name" text NOT NULL,
	"models" jsonb NOT NULL,
	"keyless" boolean NOT NULL,
	CONSTRAINT "sb_custom_model_provider_model_provider_id_unique" UNIQUE("model_provider_id")
);
--> statement-breakpoint
ALTER TABLE "sb_custom_model_provider" ADD CONSTRAINT "sb_custom_model_provider_model_provider_id_model_provider_id_fk" FOREIGN KEY ("model_provider_id") REFERENCES "public"."model_provider"("id") ON DELETE cascade ON UPDATE no action;