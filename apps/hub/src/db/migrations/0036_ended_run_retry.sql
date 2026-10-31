ALTER TABLE "sb_ended_run" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sb_ended_run" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;