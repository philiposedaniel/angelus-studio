import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'send-gallery-notice' BEFORE 'send-event-reminders';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'send-gallery-notice' BEFORE 'send-event-reminders';
  ALTER TABLE "galleries" ADD COLUMN "notify_clients" boolean DEFAULT false;
  ALTER TABLE "galleries" ADD COLUMN "clients_notified_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips', 'send-email', 'send-event-reminders');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'build-gallery-zip', 'cleanup-gallery-zips', 'send-email', 'send-event-reminders');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  ALTER TABLE "galleries" DROP COLUMN "notify_clients";
  ALTER TABLE "galleries" DROP COLUMN "clients_notified_at";`)
}
