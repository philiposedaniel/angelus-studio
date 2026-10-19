import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean DEFAULT false;
  ALTER TABLE "users" ADD COLUMN "mfa_reset" boolean DEFAULT false;
  ALTER TABLE "users" ADD COLUMN "mfa_secret" varchar;
  ALTER TABLE "users" ADD COLUMN "mfa_last_counter" numeric;
  ALTER TABLE "users" ADD COLUMN "mfa_failed_attempts" numeric;
  ALTER TABLE "users" ADD COLUMN "mfa_locked_until" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "mfa_enabled";
  ALTER TABLE "users" DROP COLUMN "mfa_reset";
  ALTER TABLE "users" DROP COLUMN "mfa_secret";
  ALTER TABLE "users" DROP COLUMN "mfa_last_counter";
  ALTER TABLE "users" DROP COLUMN "mfa_failed_attempts";
  ALTER TABLE "users" DROP COLUMN "mfa_locked_until";`)
}
