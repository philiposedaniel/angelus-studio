import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_vendors_category" AS ENUM('venue', 'catering', 'cake', 'florist', 'decor', 'rentals', 'music', 'sound-and-lighting', 'photography', 'videography', 'hair-and-makeup', 'officiant', 'transport', 'planner', 'security', 'other');
  CREATE TYPE "public"."enum_event_vendors_status" AS ENUM('proposed', 'booked', 'confirmed', 'cancelled');
  CREATE TYPE "public"."enum_event_vendors_currency" AS ENUM('eur', 'usd', 'gbp');
  CREATE TABLE "vendors" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"name" varchar NOT NULL,
  	"category" "enum_vendors_category" NOT NULL,
  	"contact_name" varchar,
  	"email" varchar,
  	"phone" varchar,
  	"website" varchar,
  	"address" varchar,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_vendors" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"event_id" integer NOT NULL,
  	"vendor_id" integer NOT NULL,
  	"role" varchar NOT NULL,
  	"status" "enum_event_vendors_status" DEFAULT 'booked' NOT NULL,
  	"arrival_at" timestamp(3) with time zone,
  	"instructions" varchar,
  	"currency" "enum_event_vendors_currency" DEFAULT 'eur' NOT NULL,
  	"amount_due" numeric DEFAULT 0,
  	"amount_paid" numeric DEFAULT 0,
  	"payment_due_date" timestamp(3) with time zone,
  	"confirmed_at" timestamp(3) with time zone,
  	"vendor_note" varchar,
  	"staff_notes" varchar,
  	"vendor_token" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "vendors_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_vendors_id" integer;
  ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_vendors" ADD CONSTRAINT "event_vendors_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "vendors_tenant_idx" ON "vendors" USING btree ("tenant_id");
  CREATE INDEX "vendors_category_idx" ON "vendors" USING btree ("category");
  CREATE INDEX "vendors_updated_at_idx" ON "vendors" USING btree ("updated_at");
  CREATE INDEX "vendors_created_at_idx" ON "vendors" USING btree ("created_at");
  CREATE INDEX "event_vendors_tenant_idx" ON "event_vendors" USING btree ("tenant_id");
  CREATE INDEX "event_vendors_event_idx" ON "event_vendors" USING btree ("event_id");
  CREATE INDEX "event_vendors_vendor_idx" ON "event_vendors" USING btree ("vendor_id");
  CREATE INDEX "event_vendors_status_idx" ON "event_vendors" USING btree ("status");
  CREATE UNIQUE INDEX "event_vendors_vendor_token_idx" ON "event_vendors" USING btree ("vendor_token");
  CREATE INDEX "event_vendors_updated_at_idx" ON "event_vendors" USING btree ("updated_at");
  CREATE INDEX "event_vendors_created_at_idx" ON "event_vendors" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_vendors_fk" FOREIGN KEY ("vendors_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_vendors_fk" FOREIGN KEY ("event_vendors_id") REFERENCES "public"."event_vendors"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_vendors_id_idx" ON "payload_locked_documents_rels" USING btree ("vendors_id");
  CREATE INDEX "payload_locked_documents_rels_event_vendors_id_idx" ON "payload_locked_documents_rels" USING btree ("event_vendors_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "vendors" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_vendors" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "vendors" CASCADE;
  DROP TABLE "event_vendors" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_vendors_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_vendors_fk";
  
  DROP INDEX "payload_locked_documents_rels_vendors_id_idx";
  DROP INDEX "payload_locked_documents_rels_event_vendors_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "vendors_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_vendors_id";
  DROP TYPE "public"."enum_vendors_category";
  DROP TYPE "public"."enum_event_vendors_status";
  DROP TYPE "public"."enum_event_vendors_currency";`)
}
