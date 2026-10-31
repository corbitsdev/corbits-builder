CREATE TABLE "sb_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"role_sha256" text NOT NULL,
	"invited_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_principal_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "sb_invitation_tenant_id_invited_by_idempotency_key_unique" UNIQUE("tenant_id","invited_by","idempotency_key"),
	CONSTRAINT "sb_invitation_terminal_check" CHECK (NOT ("sb_invitation"."accepted_at" IS NOT NULL AND "sb_invitation"."revoked_at" IS NOT NULL)),
	CONSTRAINT "sb_invitation_acceptance_check" CHECK (("sb_invitation"."accepted_at" IS NULL) = ("sb_invitation"."accepted_principal_id" IS NULL)),
	CONSTRAINT "sb_invitation_revocation_check" CHECK (("sb_invitation"."revoked_at" IS NULL) = ("sb_invitation"."revoked_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sb_invitation" ADD CONSTRAINT "sb_invitation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sb_invitation_recipient_idx" ON "sb_invitation" USING btree ("email","created_at");