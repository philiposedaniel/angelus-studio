import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "event_tables" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"event_id" integer NOT NULL,
  	"name" varchar NOT NULL,
  	"capacity" numeric DEFAULT 10 NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "event_guests" ADD COLUMN "table_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_tables_id" integer;
  ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "event_tables" ADD CONSTRAINT "event_tables_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "event_tables_tenant_idx" ON "event_tables" USING btree ("tenant_id");
  CREATE INDEX "event_tables_event_idx" ON "event_tables" USING btree ("event_id");
  CREATE INDEX "event_tables_updated_at_idx" ON "event_tables" USING btree ("updated_at");
  CREATE INDEX "event_tables_created_at_idx" ON "event_tables" USING btree ("created_at");
  ALTER TABLE "event_guests" ADD CONSTRAINT "event_guests_table_id_event_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."event_tables"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_tables_fk" FOREIGN KEY ("event_tables_id") REFERENCES "public"."event_tables"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "event_guests_table_idx" ON "event_guests" USING btree ("table_id");
  CREATE INDEX "payload_locked_documents_rels_event_tables_id_idx" ON "payload_locked_documents_rels" USING btree ("event_tables_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_tables" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_tables" CASCADE;
  ALTER TABLE "event_guests" DROP CONSTRAINT "event_guests_table_id_event_tables_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_event_tables_fk";
  
  DROP INDEX "event_guests_table_idx";
  DROP INDEX "payload_locked_documents_rels_event_tables_id_idx";
  ALTER TABLE "event_guests" DROP COLUMN "table_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_tables_id";`)
}
