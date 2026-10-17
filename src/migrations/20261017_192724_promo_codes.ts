import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_promo_codes_discount_type" AS ENUM('percent', 'amount');
  CREATE TABLE "promo_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"event_id" integer NOT NULL,
  	"code" varchar NOT NULL,
  	"discount_type" "enum_promo_codes_discount_type" DEFAULT 'percent' NOT NULL,
  	"percent_off" numeric,
  	"amount_off" numeric,
  	"max_uses" numeric,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "promo_codes_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"ticket_types_id" integer
  );
  
  ALTER TABLE "registrations" ADD COLUMN "promo_code_id" integer;
  ALTER TABLE "registrations" ADD COLUMN "discount" numeric;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "promo_codes_id" integer;
  ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "promo_codes_rels" ADD CONSTRAINT "promo_codes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promo_codes_rels" ADD CONSTRAINT "promo_codes_rels_ticket_types_fk" FOREIGN KEY ("ticket_types_id") REFERENCES "public"."ticket_types"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "promo_codes_tenant_idx" ON "promo_codes" USING btree ("tenant_id");
  CREATE INDEX "promo_codes_event_idx" ON "promo_codes" USING btree ("event_id");
  CREATE INDEX "promo_codes_code_idx" ON "promo_codes" USING btree ("code");
  CREATE INDEX "promo_codes_updated_at_idx" ON "promo_codes" USING btree ("updated_at");
  CREATE INDEX "promo_codes_created_at_idx" ON "promo_codes" USING btree ("created_at");
  CREATE INDEX "promo_codes_rels_order_idx" ON "promo_codes_rels" USING btree ("order");
  CREATE INDEX "promo_codes_rels_parent_idx" ON "promo_codes_rels" USING btree ("parent_id");
  CREATE INDEX "promo_codes_rels_path_idx" ON "promo_codes_rels" USING btree ("path");
  CREATE INDEX "promo_codes_rels_ticket_types_id_idx" ON "promo_codes_rels" USING btree ("ticket_types_id");
  ALTER TABLE "registrations" ADD CONSTRAINT "registrations_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promo_codes_fk" FOREIGN KEY ("promo_codes_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "registrations_promo_code_idx" ON "registrations" USING btree ("promo_code_id");
  CREATE INDEX "payload_locked_documents_rels_promo_codes_id_idx" ON "payload_locked_documents_rels" USING btree ("promo_codes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "promo_codes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promo_codes_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "promo_codes" CASCADE;
  DROP TABLE "promo_codes_rels" CASCADE;
  ALTER TABLE "registrations" DROP CONSTRAINT "registrations_promo_code_id_promo_codes_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_promo_codes_fk";
  
  DROP INDEX "registrations_promo_code_idx";
  DROP INDEX "payload_locked_documents_rels_promo_codes_id_idx";
  ALTER TABLE "registrations" DROP COLUMN "promo_code_id";
  ALTER TABLE "registrations" DROP COLUMN "discount";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "promo_codes_id";
  DROP TYPE "public"."enum_promo_codes_discount_type";`)
}
