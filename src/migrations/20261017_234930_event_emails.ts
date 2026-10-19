import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// The generated diff also re-created the equipment tables, because the previous snapshot was
// written before equipment reservations merged; those already exist, so only this change's
// statements are kept. This migration's snapshot includes equipment, which fixes the next diff.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'send-email';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'send-email';
  ALTER TABLE "event_guests" ADD COLUMN "invitation_sent_at" timestamp(3) with time zone;
  ALTER TABLE "registrations" ADD COLUMN "confirmation_sent_at" timestamp(3) with time zone;
  ALTER TABLE "waitlist_entries" ADD COLUMN "offer_sent_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DELETE FROM "payload_jobs_log" WHERE "task_slug" = 'send-email';
  DELETE FROM "payload_jobs" WHERE "task_slug" = 'send-email';
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  ALTER TABLE "event_guests" DROP COLUMN "invitation_sent_at";
  ALTER TABLE "registrations" DROP COLUMN "confirmation_sent_at";
  ALTER TABLE "waitlist_entries" DROP COLUMN "offer_sent_at";`)
}
