CREATE TABLE "mutation_receipt" (
	"tenant_id" text NOT NULL,
	"actor_principal_id" text NOT NULL,
	"command" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"result_body" text NOT NULL,
	CONSTRAINT "mutation_receipt_tenant_id_actor_principal_id_command_idempotency_key_pk" PRIMARY KEY("tenant_id","actor_principal_id","command","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "mutation_receipt" ADD CONSTRAINT "mutation_receipt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutation_receipt" ADD CONSTRAINT "mutation_receipt_actor_principal_id_principal_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;