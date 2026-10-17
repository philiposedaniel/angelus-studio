import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_events_invitation_style" AS ENUM('classic', 'garden', 'modern');
  CREATE TABLE "events_invitation_schedule" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"time" varchar NOT NULL
  );
  
  CREATE TABLE "events_invitation_schedule_locales" (
  	"title" varchar NOT NULL,
  	"place" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  ALTER TABLE "events" ADD COLUMN "invitation_style" "enum_events_invitation_style" DEFAULT 'classic';
  ALTER TABLE "events" ADD COLUMN "invitation_cover_image_id" integer;
  ALTER TABLE "events" ADD COLUMN "invitation_map_url" varchar;
  ALTER TABLE "events_locales" ADD COLUMN "invitation_headline" varchar;
  ALTER TABLE "events_locales" ADD COLUMN "invitation_message" varchar;
  ALTER TABLE "events_locales" ADD COLUMN "invitation_dress_code" varchar;
  ALTER TABLE "events_locales" ADD COLUMN "invitation_signature" varchar;
  ALTER TABLE "events_invitation_schedule" ADD CONSTRAINT "events_invitation_schedule_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_invitation_schedule_locales" ADD CONSTRAINT "events_invitation_schedule_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events_invitation_schedule"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_invitation_schedule_order_idx" ON "events_invitation_schedule" USING btree ("_order");
  CREATE INDEX "events_invitation_schedule_parent_id_idx" ON "events_invitation_schedule" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "events_invitation_schedule_locales_locale_parent_id_unique" ON "events_invitation_schedule_locales" USING btree ("_locale","_parent_id");
  ALTER TABLE "events" ADD CONSTRAINT "events_invitation_cover_image_id_media_id_fk" FOREIGN KEY ("invitation_cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "events_invitation_invitation_cover_image_idx" ON "events" USING btree ("invitation_cover_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "events_invitation_schedule" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "events_invitation_schedule_locales" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "events_invitation_schedule" CASCADE;
  DROP TABLE "events_invitation_schedule_locales" CASCADE;
  ALTER TABLE "events" DROP CONSTRAINT "events_invitation_cover_image_id_media_id_fk";
  
  DROP INDEX "events_invitation_invitation_cover_image_idx";
  ALTER TABLE "events" DROP COLUMN "invitation_style";
  ALTER TABLE "events" DROP COLUMN "invitation_cover_image_id";
  ALTER TABLE "events" DROP COLUMN "invitation_map_url";
  ALTER TABLE "events_locales" DROP COLUMN "invitation_headline";
  ALTER TABLE "events_locales" DROP COLUMN "invitation_message";
  ALTER TABLE "events_locales" DROP COLUMN "invitation_dress_code";
  ALTER TABLE "events_locales" DROP COLUMN "invitation_signature";
  DROP TYPE "public"."enum_events_invitation_style";`)
}
