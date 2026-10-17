import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_payments_kind" AS ENUM('deposit', 'balance');
  ALTER TYPE "public"."enum_quotes_status" ADD VALUE 'paid-in-full' BEFORE 'cancelled';
  ALTER TABLE "payments" ADD COLUMN "kind" "enum_payments_kind" DEFAULT 'deposit' NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "quotes" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "quotes" ALTER COLUMN "status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_quotes_status";
  CREATE TYPE "public"."enum_quotes_status" AS ENUM('draft', 'sent', 'deposit-paid', 'cancelled');
  ALTER TABLE "quotes" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."enum_quotes_status";
  ALTER TABLE "quotes" ALTER COLUMN "status" SET DATA TYPE "public"."enum_quotes_status" USING "status"::"public"."enum_quotes_status";
  ALTER TABLE "payments" DROP COLUMN "kind";
  DROP TYPE "public"."enum_payments_kind";`)
}
