CREATE TABLE "sb_package_grounding_receipt" (
	"assignment_id" text NOT NULL,
	"request_key" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"metadata" text NOT NULL,
	"declared_target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_package_grounding_receipt_assignment_id_request_key_pk" PRIMARY KEY("assignment_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "sb_package_grounding_receipt" ADD CONSTRAINT "sb_package_grounding_receipt_assignment_id_owner_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."owner_assignment"("id") ON DELETE no action ON UPDATE no action;