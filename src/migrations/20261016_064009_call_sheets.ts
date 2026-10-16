import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "projects_call_sheet_schedule" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"time" varchar NOT NULL,
  	"item" varchar NOT NULL,
  	"location" varchar
  );
  
  ALTER TABLE "projects" ADD COLUMN "call_sheet_meeting_point" varchar;
  ALTER TABLE "projects" ADD COLUMN "call_sheet_notes" varchar;
  ALTER TABLE "projects_call_sheet_schedule" ADD CONSTRAINT "projects_call_sheet_schedule_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "projects_call_sheet_schedule_order_idx" ON "projects_call_sheet_schedule" USING btree ("_order");
  CREATE INDEX "projects_call_sheet_schedule_parent_id_idx" ON "projects_call_sheet_schedule" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "projects_call_sheet_schedule" CASCADE;
  ALTER TABLE "projects" DROP COLUMN "call_sheet_meeting_point";
  ALTER TABLE "projects" DROP COLUMN "call_sheet_notes";`)
}
