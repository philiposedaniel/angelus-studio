import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_event_guests_language" AS ENUM('en', 'es', 'fr', 'pt', 'de', 'it');
  CREATE TYPE "public"."enum_event_guests_rsvp_status" AS ENUM('pending', 'attending', 'declined');
  CREATE TABLE "event_guests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"event_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"email" varchar,
  	"phone" varchar,
  	"group" varchar,
  	"party_size" numeric DEFAULT 1 NOT NULL,
  	"language" "enum_event_guests_language" DEFAULT 'en' NOT NULL,
  	"rsvp_status" "enum_event_guests_rsvp_status" DEFAULT 'pending' NOT NULL,
  	"attending_count" numeric DEFAULT 0,
  	"dietary_notes" varchar,
  	"guest_message" varchar,
  	"responded_at" timestamp(3) with time zone,
  	"staff_notes" varchar,
  	"invite_token" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "events" ADD COLUMN "rsvp_open" boolean DEFAULT true;
  ALTER TABLE "events" ADD COLUMN "rsvp_deadline" timestamp(3) with time zone;
  ALTER TABLE "events" ADD COLUMN "listed" boolean DEFAULT true;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_guests_id" integer;
  ALTER TABLE "event_guests" ADD CONSTRAINT "event_guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_guests" ADD CONSTRAINT "event_guests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "event_guests_tenant_idx" ON "event_guests" USING btree ("tenant_id");
  CREATE INDEX "event_guests_event_idx" ON "event_guests" USING btree ("event_id");
  CREATE INDEX "event_guests_email_idx" ON "event_guests" USING btree ("email");
  CREATE INDEX "event_guests_rsvp_status_idx" ON "event_guests" USING btree ("rsvp_status");
  CREATE UNIQUE INDEX "event_guests_invite_token_idx" ON "event_guests" USING btree ("invite_token");
  CREATE INDEX "event_guests_updated_at_idx" ON "event_guests" USING btree ("updated_at");
  CREATE INDEX "event_guests_created_at_idx" ON "event_guests" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_guests_fk" FOREIGN KEY ("event_guests_id") REFERENCES "public"."event_guests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_listed_idx" ON "events" USING btree ("listed");
  CREATE INDEX "payload_locked_documents_rels_event_guests_id_idx" ON "payload_locked_documents_rels" USING btree ("event_guests_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_guests" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_guests" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_guests_fk";
  
  DROP INDEX "events_listed_idx";
  DROP INDEX "payload_locked_documents_rels_event_guests_id_idx";
  ALTER TABLE "events" DROP COLUMN "rsvp_open";
  ALTER TABLE "events" DROP COLUMN "rsvp_deadline";
  ALTER TABLE "events" DROP COLUMN "listed";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_guests_id";
  DROP TYPE "public"."enum_event_guests_language";
  DROP TYPE "public"."enum_event_guests_rsvp_status";`)
}
