import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "galleries" ADD COLUMN "share_enabled" boolean DEFAULT false;
  ALTER TABLE "galleries" ADD COLUMN "share_token" varchar;
  CREATE INDEX "galleries_share_token_idx" ON "galleries" USING btree ("share_token");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "galleries_share_token_idx";
  ALTER TABLE "galleries" DROP COLUMN "share_enabled";
  ALTER TABLE "galleries" DROP COLUMN "share_token";`)
}
