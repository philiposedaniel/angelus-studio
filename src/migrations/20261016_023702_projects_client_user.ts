import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN "client_user_id" integer;
  ALTER TABLE "projects" ADD CONSTRAINT "projects_client_user_id_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "projects_client_user_idx" ON "projects" USING btree ("client_user_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP CONSTRAINT "projects_client_user_id_users_id_fk";
  
  DROP INDEX "projects_client_user_idx";
  ALTER TABLE "projects" DROP COLUMN "client_user_id";`)
}
