import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_ticket_types_currency" AS ENUM('eur', 'usd', 'gbp');
  CREATE TYPE "public"."enum_registrations_currency" AS ENUM('eur', 'usd', 'gbp');
  ALTER TYPE "public"."enum_payments_kind" ADD VALUE 'ticket';
  ALTER TYPE "public"."enum_payments_status" ADD VALUE 'expired';
  ALTER TYPE "public"."enum_registrations_status" ADD VALUE 'pending' BEFORE 'confirmed';
  ALTER TABLE "payments" ALTER COLUMN "quote_id" DROP NOT NULL;
  ALTER TABLE "payments" ADD COLUMN "registration_id" integer;
  ALTER TABLE "ticket_types" ADD COLUMN "price" numeric DEFAULT 0 NOT NULL;
  ALTER TABLE "ticket_types" ADD COLUMN "currency" "enum_ticket_types_currency" DEFAULT 'eur' NOT NULL;
  ALTER TABLE "registrations" ADD COLUMN "hold_expires_at" timestamp(3) with time zone;
  ALTER TABLE "registrations" ADD COLUMN "amount" numeric;
  ALTER TABLE "registrations" ADD COLUMN "currency" "enum_registrations_currency";
  ALTER TABLE "payments" ADD CONSTRAINT "payments_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "payments_registration_idx" ON "payments" USING btree ("registration_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payments" DROP CONSTRAINT "payments_registration_id_registrations_id_fk";
  
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DATA TYPE text;
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DEFAULT 'deposit'::text;
  DROP TYPE "public"."enum_payments_kind";
  CREATE TYPE "public"."enum_payments_kind" AS ENUM('deposit', 'balance');
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DEFAULT 'deposit'::"public"."enum_payments_kind";
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_payments_kind" USING "kind"::"public"."enum_payments_kind";
  ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_payments_status";
  CREATE TYPE "public"."enum_payments_status" AS ENUM('pending', 'paid', 'failed');
  ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_payments_status";
  ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."enum_payments_status" USING "status"::"public"."enum_payments_status";
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DEFAULT 'confirmed'::text;
  DROP TYPE "public"."enum_registrations_status";
  CREATE TYPE "public"."enum_registrations_status" AS ENUM('confirmed', 'cancelled');
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DEFAULT 'confirmed'::"public"."enum_registrations_status";
  ALTER TABLE "registrations" ALTER COLUMN "status" SET DATA TYPE "public"."enum_registrations_status" USING "status"::"public"."enum_registrations_status";
  DROP INDEX "payments_registration_idx";
  ALTER TABLE "payments" ALTER COLUMN "quote_id" SET NOT NULL;
  ALTER TABLE "payments" DROP COLUMN "registration_id";
  ALTER TABLE "ticket_types" DROP COLUMN "price";
  ALTER TABLE "ticket_types" DROP COLUMN "currency";
  ALTER TABLE "registrations" DROP COLUMN "hold_expires_at";
  ALTER TABLE "registrations" DROP COLUMN "amount";
  ALTER TABLE "registrations" DROP COLUMN "currency";
  DROP TYPE "public"."enum_ticket_types_currency";
  DROP TYPE "public"."enum_registrations_currency";`)
}
