CREATE TABLE IF NOT EXISTS "automation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_name" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"response" text,
	"request_data" jsonb,
	"unique_id" text,
	"email_response" text,
	"email_received_at" timestamp,
	"agent_response" text,
	"agent_name" text,
	"agent_received_at" timestamp,
	"webhook_payload" jsonb,
	"chain_type" text,
	"is_completed" boolean DEFAULT false,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" serial NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_run_id" text NOT NULL,
	"call_sid" text,
	"patient_id" text,
	"phone" text,
	"status" text DEFAULT 'created' NOT NULL,
	"callback_url" text NOT NULL,
	"context" jsonb,
	"summary" jsonb,
	"risk_last" numeric,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "calls_call_sid_unique" UNIQUE("call_sid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "custom_chains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_events_call_id" ON "call_events" ("call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_call_events_timestamp" ON "call_events" ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calls_chain_run" ON "calls" ("chain_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_calls_call_sid" ON "calls" ("call_sid");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
