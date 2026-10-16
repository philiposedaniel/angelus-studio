import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_guests" ADD COLUMN "checked_in_count" numeric DEFAULT 0;
  ALTER TABLE "event_guests" ADD COLUMN "checked_in_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_guests" DROP COLUMN "checked_in_count";
  ALTER TABLE "event_guests" DROP COLUMN "checked_in_at";`)
}
