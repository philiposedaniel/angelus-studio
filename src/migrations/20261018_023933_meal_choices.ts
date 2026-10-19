import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "events_meal_options" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "events_meal_options_locales" (
  	"label" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "event_guests_party" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"meal" varchar
  );
  
  ALTER TABLE "events_meal_options" ADD CONSTRAINT "events_meal_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_meal_options_locales" ADD CONSTRAINT "events_meal_options_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events_meal_options"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "event_guests_party" ADD CONSTRAINT "event_guests_party_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."event_guests"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_meal_options_order_idx" ON "events_meal_options" USING btree ("_order");
  CREATE INDEX "events_meal_options_parent_id_idx" ON "events_meal_options" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "events_meal_options_locales_locale_parent_id_unique" ON "events_meal_options_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "event_guests_party_order_idx" ON "event_guests_party" USING btree ("_order");
  CREATE INDEX "event_guests_party_parent_id_idx" ON "event_guests_party" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "events_meal_options" CASCADE;
  DROP TABLE "events_meal_options_locales" CASCADE;
  DROP TABLE "event_guests_party" CASCADE;`)
}
