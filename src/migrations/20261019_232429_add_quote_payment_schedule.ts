import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payments_kind" ADD VALUE 'installment' BEFORE 'ticket';
  CREATE TABLE "quotes_payment_schedule" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"due_date" timestamp(3) with time zone NOT NULL,
  	"amount" numeric NOT NULL
  );
  
  ALTER TABLE "payments" ADD COLUMN "installment_number" numeric;
  ALTER TABLE "quotes_payment_schedule" ADD CONSTRAINT "quotes_payment_schedule_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "quotes_payment_schedule_order_idx" ON "quotes_payment_schedule" USING btree ("_order");
  CREATE INDEX "quotes_payment_schedule_parent_id_idx" ON "quotes_payment_schedule" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "quotes_payment_schedule" CASCADE;
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DATA TYPE text;
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DEFAULT 'deposit'::text;
  DROP TYPE "public"."enum_payments_kind";
  CREATE TYPE "public"."enum_payments_kind" AS ENUM('deposit', 'balance', 'ticket');
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DEFAULT 'deposit'::"public"."enum_payments_kind";
  ALTER TABLE "payments" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_payments_kind" USING "kind"::"public"."enum_payments_kind";
  ALTER TABLE "payments" DROP COLUMN "installment_number";`)
}
