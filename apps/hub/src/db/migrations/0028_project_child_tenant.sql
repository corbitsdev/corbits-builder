ALTER TABLE "sb_build_gate_pass" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_cost_basis_receipt" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_assignment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_package_grounding_receipt" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_project_upload" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_version_lineage" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_spend_authorization" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_spend_reservation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_upload_classification" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_upload_classifier_assignment" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_upload_read_receipt" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sb_upload_route" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_report" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sb_build_gate_pass" CASCADE;--> statement-breakpoint
DROP TABLE "sb_cost_basis_receipt" CASCADE;--> statement-breakpoint
DROP TABLE "decision" CASCADE;--> statement-breakpoint
DROP TABLE "owner_assignment" CASCADE;--> statement-breakpoint
DROP TABLE "sb_package_grounding_receipt" CASCADE;--> statement-breakpoint
DROP TABLE "sb_project_upload" CASCADE;--> statement-breakpoint
DROP TABLE "project_version_lineage" CASCADE;--> statement-breakpoint
DROP TABLE "sb_spend_authorization" CASCADE;--> statement-breakpoint
DROP TABLE "sb_spend_reservation" CASCADE;--> statement-breakpoint
DROP TABLE "sb_upload_classification" CASCADE;--> statement-breakpoint
DROP TABLE "sb_upload_classifier_assignment" CASCADE;--> statement-breakpoint
DROP TABLE "sb_upload_read_receipt" CASCADE;--> statement-breakpoint
DROP TABLE "sb_upload_route" CASCADE;--> statement-breakpoint
DROP TABLE "worker_report" CASCADE;--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_revision_check";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "version_of_project_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_version_of_project_id_project_id_fk" FOREIGN KEY ("version_of_project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "plan";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "revision";--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_unique" UNIQUE("tenant_id");