import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_gallery_selections_status" AS ENUM('open', 'submitted', 'revision-requested', 'approved');
  CREATE TABLE "gallery_selections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"gallery_id" integer NOT NULL,
  	"user_id" integer NOT NULL,
  	"status" "enum_gallery_selections_status" DEFAULT 'open' NOT NULL,
  	"submitted_at" timestamp(3) with time zone,
  	"approved_at" timestamp(3) with time zone,
  	"feedback" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "galleries" ADD COLUMN "selection_limit" numeric;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_selections_id" integer;
  ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_selections" ADD CONSTRAINT "gallery_selections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "gallery_selections_tenant_idx" ON "gallery_selections" USING btree ("tenant_id");
  CREATE INDEX "gallery_selections_gallery_idx" ON "gallery_selections" USING btree ("gallery_id");
  CREATE INDEX "gallery_selections_user_idx" ON "gallery_selections" USING btree ("user_id");
  CREATE INDEX "gallery_selections_updated_at_idx" ON "gallery_selections" USING btree ("updated_at");
  CREATE INDEX "gallery_selections_created_at_idx" ON "gallery_selections" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_selections_fk" FOREIGN KEY ("gallery_selections_id") REFERENCES "public"."gallery_selections"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_gallery_selections_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_selections_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "gallery_selections" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "gallery_selections" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_selections_fk";
  
  DROP INDEX "payload_locked_documents_rels_gallery_selections_id_idx";
  ALTER TABLE "galleries" DROP COLUMN "selection_limit";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_selections_id";
  DROP TYPE "public"."enum_gallery_selections_status";`)
}
