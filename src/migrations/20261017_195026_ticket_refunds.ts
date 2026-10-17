import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payments_status" ADD VALUE 'refund-pending';
  ALTER TYPE "public"."enum_payments_status" ADD VALUE 'refunded';
  ALTER TABLE "payments" ADD COLUMN "refunded_amount" numeric;
  ALTER TABLE "payments" ADD COLUMN "refunded_at" timestamp(3) with time zone;
  ALTER TABLE "payments" ADD COLUMN "stripe_payment_intent_id" varchar;
  ALTER TABLE "payments" ADD COLUMN "stripe_refund_id" varchar;
  CREATE INDEX "payments_stripe_payment_intent_id_idx" ON "payments" USING btree ("stripe_payment_intent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_payments_status";
  CREATE TYPE "public"."enum_payments_status" AS ENUM('pending', 'paid', 'failed', 'expired');
  ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_payments_status";
  ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."enum_payments_status" USING "status"::"public"."enum_payments_status";
  DROP INDEX "payments_stripe_payment_intent_id_idx";
  ALTER TABLE "payments" DROP COLUMN "refunded_amount";
  ALTER TABLE "payments" DROP COLUMN "refunded_at";
  ALTER TABLE "payments" DROP COLUMN "stripe_payment_intent_id";
  ALTER TABLE "payments" DROP COLUMN "stripe_refund_id";`)
}
