import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_quotes_currency" AS ENUM('eur', 'usd', 'gbp');
  CREATE TYPE "public"."enum_quotes_status" AS ENUM('draft', 'sent', 'deposit-paid', 'cancelled');
  CREATE TYPE "public"."enum_payments_currency" AS ENUM('eur', 'usd', 'gbp');
  CREATE TYPE "public"."enum_payments_status" AS ENUM('pending', 'paid', 'failed');
  CREATE TABLE "quotes_line_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"description" varchar NOT NULL,
  	"quantity" numeric DEFAULT 1 NOT NULL,
  	"unit_amount" numeric NOT NULL
  );
  
  CREATE TABLE "quotes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"title" varchar NOT NULL,
  	"client_name" varchar NOT NULL,
  	"client_email" varchar NOT NULL,
  	"inquiry_id" integer,
  	"currency" "enum_quotes_currency" DEFAULT 'eur' NOT NULL,
  	"deposit_percent" numeric DEFAULT 30 NOT NULL,
  	"total_amount" numeric,
  	"deposit_amount" numeric,
  	"status" "enum_quotes_status" DEFAULT 'draft' NOT NULL,
  	"valid_until" timestamp(3) with time zone,
  	"public_token" varchar,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"quote_id" integer NOT NULL,
  	"amount" numeric NOT NULL,
  	"currency" "enum_payments_currency" NOT NULL,
  	"status" "enum_payments_status" DEFAULT 'pending' NOT NULL,
  	"paid_at" timestamp(3) with time zone,
  	"stripe_session_id" varchar NOT NULL,
  	"stripe_event_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "quotes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "payments_id" integer;
  ALTER TABLE "quotes_line_items" ADD CONSTRAINT "quotes_line_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "quotes" ADD CONSTRAINT "quotes_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payments" ADD CONSTRAINT "payments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "quotes_line_items_order_idx" ON "quotes_line_items" USING btree ("_order");
  CREATE INDEX "quotes_line_items_parent_id_idx" ON "quotes_line_items" USING btree ("_parent_id");
  CREATE INDEX "quotes_tenant_idx" ON "quotes" USING btree ("tenant_id");
  CREATE INDEX "quotes_inquiry_idx" ON "quotes" USING btree ("inquiry_id");
  CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");
  CREATE UNIQUE INDEX "quotes_public_token_idx" ON "quotes" USING btree ("public_token");
  CREATE INDEX "quotes_updated_at_idx" ON "quotes" USING btree ("updated_at");
  CREATE INDEX "quotes_created_at_idx" ON "quotes" USING btree ("created_at");
  CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");
  CREATE INDEX "payments_quote_idx" ON "payments" USING btree ("quote_id");
  CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");
  CREATE UNIQUE INDEX "payments_stripe_session_id_idx" ON "payments" USING btree ("stripe_session_id");
  CREATE INDEX "payments_stripe_event_id_idx" ON "payments" USING btree ("stripe_event_id");
  CREATE INDEX "payments_updated_at_idx" ON "payments" USING btree ("updated_at");
  CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_quotes_fk" FOREIGN KEY ("quotes_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_payments_fk" FOREIGN KEY ("payments_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_quotes_id_idx" ON "payload_locked_documents_rels" USING btree ("quotes_id");
  CREATE INDEX "payload_locked_documents_rels_payments_id_idx" ON "payload_locked_documents_rels" USING btree ("payments_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "quotes_line_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "quotes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "quotes_line_items" CASCADE;
  DROP TABLE "quotes" CASCADE;
  DROP TABLE "payments" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_quotes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_payments_fk";
  
  DROP INDEX "payload_locked_documents_rels_quotes_id_idx";
  DROP INDEX "payload_locked_documents_rels_payments_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "quotes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "payments_id";
  DROP TYPE "public"."enum_quotes_currency";
  DROP TYPE "public"."enum_quotes_status";
  DROP TYPE "public"."enum_payments_currency";
  DROP TYPE "public"."enum_payments_status";`)
}
