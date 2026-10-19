import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "equipment_reservations" ADD COLUMN "checked_out_at" timestamp(3) with time zone;
  ALTER TABLE "equipment_reservations" ADD COLUMN "returned_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "equipment_reservations" DROP COLUMN "checked_out_at";
  ALTER TABLE "equipment_reservations" DROP COLUMN "returned_at";`)
}
