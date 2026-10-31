CREATE TABLE "project_coordinator" (
	"run_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"registered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_coordinator" ADD CONSTRAINT "project_coordinator_run_id_workflow_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_coordinator" ADD CONSTRAINT "project_coordinator_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_coordinator" ADD CONSTRAINT "project_coordinator_registered_by_principal_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."principal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_coordinator_active_project_idx" ON "project_coordinator" USING btree ("project_id") WHERE "project_coordinator"."active";