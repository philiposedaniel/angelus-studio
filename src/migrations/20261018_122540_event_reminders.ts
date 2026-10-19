import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'send-event-reminders';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'send-event-reminders';
  ALTER TABLE "events" ADD COLUMN "reminder_emails" boolean DEFAULT true;
  ALTER TABLE "event_guests" ADD COLUMN "reply_reminder_sent_at" timestamp(3) with time zone;
  ALTER TABLE "event_guests" ADD COLUMN "day_before_sent_at" timestamp(3) with time zone;
  ALTER TABLE "registrations" ADD COLUMN "day_before_sent_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips', 'send-email');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips', 'send-email');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  ALTER TABLE "events" DROP COLUMN "reminder_emails";
  ALTER TABLE "event_guests" DROP COLUMN "reply_reminder_sent_at";
  ALTER TABLE "event_guests" DROP COLUMN "day_before_sent_at";
  ALTER TABLE "registrations" DROP COLUMN "day_before_sent_at";`)
}
