CREATE TABLE "sb_cost_basis_receipt" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sb_cost_basis_receipt" ADD CONSTRAINT "sb_cost_basis_receipt_assignment_id_owner_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."owner_assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sb_cost_basis_receipt" ADD CONSTRAINT "sb_cost_basis_receipt_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;