import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_galleries_status" AS ENUM('draft', 'published');
  CREATE TABLE "galleries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"slug" varchar NOT NULL,
  	"status" "enum_galleries_status" DEFAULT 'draft' NOT NULL,
  	"expires_at" timestamp(3) with time zone,
  	"allow_downloads" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "galleries_locales" (
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "galleries_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "gallery_photos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"gallery_id" integer NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar,
  	"sizes_web_url" varchar,
  	"sizes_web_width" numeric,
  	"sizes_web_height" numeric,
  	"sizes_web_mime_type" varchar,
  	"sizes_web_filesize" numeric,
  	"sizes_web_filename" varchar
  );
  
  CREATE TABLE "gallery_photos_locales" (
  	"alt" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "gallery_favorites" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"user_id" integer NOT NULL,
  	"photo_id" integer NOT NULL,
  	"gallery_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "galleries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_photos_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_favorites_id" integer;
  ALTER TABLE "galleries" ADD CONSTRAINT "galleries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "galleries_locales" ADD CONSTRAINT "galleries_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "galleries_rels" ADD CONSTRAINT "galleries_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "galleries_rels" ADD CONSTRAINT "galleries_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_photos" ADD CONSTRAINT "gallery_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_photos" ADD CONSTRAINT "gallery_photos_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_photos_locales" ADD CONSTRAINT "gallery_photos_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_photos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_favorites" ADD CONSTRAINT "gallery_favorites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_favorites" ADD CONSTRAINT "gallery_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_favorites" ADD CONSTRAINT "gallery_favorites_photo_id_gallery_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."gallery_photos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_favorites" ADD CONSTRAINT "gallery_favorites_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "galleries_tenant_idx" ON "galleries" USING btree ("tenant_id");
  CREATE INDEX "galleries_slug_idx" ON "galleries" USING btree ("slug");
  CREATE INDEX "galleries_status_idx" ON "galleries" USING btree ("status");
  CREATE INDEX "galleries_updated_at_idx" ON "galleries" USING btree ("updated_at");
  CREATE INDEX "galleries_created_at_idx" ON "galleries" USING btree ("created_at");
  CREATE UNIQUE INDEX "galleries_locales_locale_parent_id_unique" ON "galleries_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "galleries_rels_order_idx" ON "galleries_rels" USING btree ("order");
  CREATE INDEX "galleries_rels_parent_idx" ON "galleries_rels" USING btree ("parent_id");
  CREATE INDEX "galleries_rels_path_idx" ON "galleries_rels" USING btree ("path");
  CREATE INDEX "galleries_rels_users_id_idx" ON "galleries_rels" USING btree ("users_id");
  CREATE INDEX "gallery_photos_tenant_idx" ON "gallery_photos" USING btree ("tenant_id");
  CREATE INDEX "gallery_photos_gallery_idx" ON "gallery_photos" USING btree ("gallery_id");
  CREATE INDEX "gallery_photos_sort_order_idx" ON "gallery_photos" USING btree ("sort_order");
  CREATE INDEX "gallery_photos_updated_at_idx" ON "gallery_photos" USING btree ("updated_at");
  CREATE INDEX "gallery_photos_created_at_idx" ON "gallery_photos" USING btree ("created_at");
  CREATE UNIQUE INDEX "gallery_photos_filename_idx" ON "gallery_photos" USING btree ("filename");
  CREATE INDEX "gallery_photos_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "gallery_photos" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "gallery_photos_sizes_web_sizes_web_filename_idx" ON "gallery_photos" USING btree ("sizes_web_filename");
  CREATE UNIQUE INDEX "gallery_photos_locales_locale_parent_id_unique" ON "gallery_photos_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "gallery_favorites_tenant_idx" ON "gallery_favorites" USING btree ("tenant_id");
  CREATE INDEX "gallery_favorites_user_idx" ON "gallery_favorites" USING btree ("user_id");
  CREATE INDEX "gallery_favorites_photo_idx" ON "gallery_favorites" USING btree ("photo_id");
  CREATE INDEX "gallery_favorites_gallery_idx" ON "gallery_favorites" USING btree ("gallery_id");
  CREATE INDEX "gallery_favorites_updated_at_idx" ON "gallery_favorites" USING btree ("updated_at");
  CREATE INDEX "gallery_favorites_created_at_idx" ON "gallery_favorites" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_galleries_fk" FOREIGN KEY ("galleries_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_photos_fk" FOREIGN KEY ("gallery_photos_id") REFERENCES "public"."gallery_photos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_favorites_fk" FOREIGN KEY ("gallery_favorites_id") REFERENCES "public"."gallery_favorites"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_galleries_id_idx" ON "payload_locked_documents_rels" USING btree ("galleries_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_photos_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_photos_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_favorites_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_favorites_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "galleries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "galleries_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "galleries_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_photos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_photos_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_favorites" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "galleries" CASCADE;
  DROP TABLE "galleries_locales" CASCADE;
  DROP TABLE "galleries_rels" CASCADE;
  DROP TABLE "gallery_photos" CASCADE;
  DROP TABLE "gallery_photos_locales" CASCADE;
  DROP TABLE "gallery_favorites" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_galleries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_photos_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_favorites_fk";
  
  DROP INDEX "payload_locked_documents_rels_galleries_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_photos_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_favorites_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "galleries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_photos_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_favorites_id";
  DROP TYPE "public"."enum_galleries_status";`)
}
