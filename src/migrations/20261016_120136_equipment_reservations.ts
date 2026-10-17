import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "equipment" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"name" varchar NOT NULL,
  	"category" varchar,
  	"serial_number" varchar,
  	"active" boolean DEFAULT true,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "equipment_reservations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"equipment_id" integer NOT NULL,
  	"project_id" integer NOT NULL,
  	"starts_at" timestamp(3) with time zone NOT NULL,
  	"ends_at" timestamp(3) with time zone NOT NULL,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  -- The database refuses two reservations of the same kit over overlapping times, even when two
  -- requests check at once. A reservation ends where the next one may start: [start, end).
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_no_overlap" EXCLUDE USING gist ("equipment_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "equipment_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "equipment_reservations_id" integer;
  ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "equipment_reservations" ADD CONSTRAINT "equipment_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "equipment_tenant_idx" ON "equipment" USING btree ("tenant_id");
  CREATE INDEX "equipment_active_idx" ON "equipment" USING btree ("active");
  CREATE INDEX "equipment_updated_at_idx" ON "equipment" USING btree ("updated_at");
  CREATE INDEX "equipment_created_at_idx" ON "equipment" USING btree ("created_at");
  CREATE INDEX "equipment_reservations_tenant_idx" ON "equipment_reservations" USING btree ("tenant_id");
  CREATE INDEX "equipment_reservations_equipment_idx" ON "equipment_reservations" USING btree ("equipment_id");
  CREATE INDEX "equipment_reservations_project_idx" ON "equipment_reservations" USING btree ("project_id");
  CREATE INDEX "equipment_reservations_starts_at_idx" ON "equipment_reservations" USING btree ("starts_at");
  CREATE INDEX "equipment_reservations_updated_at_idx" ON "equipment_reservations" USING btree ("updated_at");
  CREATE INDEX "equipment_reservations_created_at_idx" ON "equipment_reservations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_equipment_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_equipment_reservations_fk" FOREIGN KEY ("equipment_reservations_id") REFERENCES "public"."equipment_reservations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_equipment_id_idx" ON "payload_locked_documents_rels" USING btree ("equipment_id");
  CREATE INDEX "payload_locked_documents_rels_equipment_reservations_id_idx" ON "payload_locked_documents_rels" USING btree ("equipment_reservations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "equipment" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "equipment_reservations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "equipment" CASCADE;
  DROP TABLE "equipment_reservations" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_equipment_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_equipment_reservations_fk";
  
  DROP INDEX "payload_locked_documents_rels_equipment_id_idx";
  DROP INDEX "payload_locked_documents_rels_equipment_reservations_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "equipment_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "equipment_reservations_id";`)
}
