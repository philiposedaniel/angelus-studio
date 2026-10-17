import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_registrations_status" AS ENUM('confirmed', 'cancelled');
  CREATE TYPE "public"."enum_registrations_language" AS ENUM('en', 'es', 'fr', 'pt', 'de', 'it');
  CREATE TABLE "ticket_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"event_id" integer NOT NULL,
  	"capacity" numeric DEFAULT 100 NOT NULL,
  	"max_per_order" numeric DEFAULT 10 NOT NULL,
  	"sales_start" timestamp(3) with time zone,
  	"sales_end" timestamp(3) with time zone,
  	"on_sale" boolean DEFAULT true,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ticket_types_locales" (
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "registrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"ticket_type_id" integer NOT NULL,
  	"event_id" integer,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"quantity" numeric DEFAULT 1 NOT NULL,
  	"status" "enum_registrations_status" DEFAULT 'confirmed' NOT NULL,
  	"language" "enum_registrations_language" DEFAULT 'en' NOT NULL,
  	"checked_in_count" numeric DEFAULT 0,
  	"checked_in_at" timestamp(3) with time zone,
  	"staff_notes" varchar,
  	"ticket_token" varchar,
  	"sender_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ticket_types_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "registrations_id" integer;
  ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_types_locales" ADD CONSTRAINT "ticket_types_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."ticket_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "ticket_types_tenant_idx" ON "ticket_types" USING btree ("tenant_id");
  CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id");
  CREATE INDEX "ticket_types_updated_at_idx" ON "ticket_types" USING btree ("updated_at");
  CREATE INDEX "ticket_types_created_at_idx" ON "ticket_types" USING btree ("created_at");
  CREATE UNIQUE INDEX "ticket_types_locales_locale_parent_id_unique" ON "ticket_types_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "registrations_tenant_idx" ON "registrations" USING btree ("tenant_id");
  CREATE INDEX "registrations_ticket_type_idx" ON "registrations" USING btree ("ticket_type_id");
  CREATE INDEX "registrations_event_idx" ON "registrations" USING btree ("event_id");
  CREATE INDEX "registrations_email_idx" ON "registrations" USING btree ("email");
  CREATE INDEX "registrations_status_idx" ON "registrations" USING btree ("status");
  CREATE UNIQUE INDEX "registrations_ticket_token_idx" ON "registrations" USING btree ("ticket_token");
  CREATE INDEX "registrations_sender_key_idx" ON "registrations" USING btree ("sender_key");
  CREATE INDEX "registrations_updated_at_idx" ON "registrations" USING btree ("updated_at");
  CREATE INDEX "registrations_created_at_idx" ON "registrations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ticket_types_fk" FOREIGN KEY ("ticket_types_id") REFERENCES "public"."ticket_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_registrations_fk" FOREIGN KEY ("registrations_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ticket_types_id_idx" ON "payload_locked_documents_rels" USING btree ("ticket_types_id");
  CREATE INDEX "payload_locked_documents_rels_registrations_id_idx" ON "payload_locked_documents_rels" USING btree ("registrations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ticket_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "ticket_types_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "registrations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "ticket_types" CASCADE;
  DROP TABLE "ticket_types_locales" CASCADE;
  DROP TABLE "registrations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ticket_types_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_registrations_fk";
  
  DROP INDEX "payload_locked_documents_rels_ticket_types_id_idx";
  DROP INDEX "payload_locked_documents_rels_registrations_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ticket_types_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "registrations_id";
  DROP TYPE "public"."enum_registrations_status";
  DROP TYPE "public"."enum_registrations_language";`)
}
