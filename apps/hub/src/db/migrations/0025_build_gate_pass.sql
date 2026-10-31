CREATE TABLE "sb_build_gate_pass" (
	"assignment_id" text NOT NULL,
	"pass" bigint NOT NULL,
	"invocation_id" text NOT NULL,
	"gate_sha256" text NOT NULL,
	"state" text NOT NULL,
	"observation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "sb_build_gate_pass_assignment_id_pass_pk" PRIMARY KEY("assignment_id","pass"),
	CONSTRAINT "sb_build_gate_pass_assignment_id_invocation_id_unique" UNIQUE("assignment_id","invocation_id"),
	CONSTRAINT "sb_build_gate_pass_positive" CHECK ("sb_build_gate_pass"."pass" > 0),
	CONSTRAINT "sb_build_gate_pass_state" CHECK ("sb_build_gate_pass"."state" in ('reserved','settled','unknown'))
);
--> statement-breakpoint
ALTER TABLE "sb_build_gate_pass" ADD CONSTRAINT "sb_build_gate_pass_assignment_id_owner_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."owner_assignment"("id") ON DELETE no action ON UPDATE no action;