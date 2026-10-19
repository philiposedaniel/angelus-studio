import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_vendors" ADD COLUMN "booking_emailed_at" timestamp(3) with time zone;
  ALTER TABLE "event_vendors" ADD COLUMN "confirmation_notice_sent_for" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_vendors" DROP COLUMN "booking_emailed_at";
  ALTER TABLE "event_vendors" DROP COLUMN "confirmation_notice_sent_for";`)
}
