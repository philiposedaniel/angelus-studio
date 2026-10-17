import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_waitlist_entries_status" AS ENUM('waiting', 'offered', 'claimed', 'expired', 'left', 'removed');
  CREATE TYPE "public"."enum_waitlist_entries_language" AS ENUM('en', 'es', 'fr', 'pt', 'de', 'it');
  CREATE TABLE "waitlist_entries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"ticket_type_id" integer NOT NULL,
  	"event_id" integer,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"quantity" numeric DEFAULT 1 NOT NULL,
  	"status" "enum_waitlist_entries_status" DEFAULT 'waiting' NOT NULL,
  	"offer_expires_at" timestamp(3) with time zone,
  	"registration_id" integer,
  	"language" "enum_waitlist_entries_language" DEFAULT 'en' NOT NULL,
  	"claim_token" varchar,
  	"sender_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "waitlist_entries_id" integer;
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "waitlist_entries_tenant_idx" ON "waitlist_entries" USING btree ("tenant_id");
  CREATE INDEX "waitlist_entries_ticket_type_idx" ON "waitlist_entries" USING btree ("ticket_type_id");
  CREATE INDEX "waitlist_entries_event_idx" ON "waitlist_entries" USING btree ("event_id");
  CREATE INDEX "waitlist_entries_email_idx" ON "waitlist_entries" USING btree ("email");
  CREATE INDEX "waitlist_entries_status_idx" ON "waitlist_entries" USING btree ("status");
  CREATE INDEX "waitlist_entries_registration_idx" ON "waitlist_entries" USING btree ("registration_id");
  CREATE UNIQUE INDEX "waitlist_entries_claim_token_idx" ON "waitlist_entries" USING btree ("claim_token");
  CREATE INDEX "waitlist_entries_sender_key_idx" ON "waitlist_entries" USING btree ("sender_key");
  CREATE INDEX "waitlist_entries_updated_at_idx" ON "waitlist_entries" USING btree ("updated_at");
  CREATE INDEX "waitlist_entries_created_at_idx" ON "waitlist_entries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_waitlist_entries_fk" FOREIGN KEY ("waitlist_entries_id") REFERENCES "public"."waitlist_entries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_waitlist_entries_id_idx" ON "payload_locked_documents_rels" USING btree ("waitlist_entries_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "waitlist_entries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "waitlist_entries" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_waitlist_entries_fk";
  
  DROP INDEX "payload_locked_documents_rels_waitlist_entries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "waitlist_entries_id";
  DROP TYPE "public"."enum_waitlist_entries_status";
  DROP TYPE "public"."enum_waitlist_entries_language";`)
}
