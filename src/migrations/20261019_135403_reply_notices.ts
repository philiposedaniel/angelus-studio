import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events" ADD COLUMN "reply_notices" boolean DEFAULT true;
  ALTER TABLE "events" ADD COLUMN "reply_notice_email" varchar;
  ALTER TABLE "event_guests" ADD COLUMN "reply_notice_sent_for" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events" DROP COLUMN "reply_notices";
  ALTER TABLE "events" DROP COLUMN "reply_notice_email";
  ALTER TABLE "event_guests" DROP COLUMN "reply_notice_sent_for";`)
}
