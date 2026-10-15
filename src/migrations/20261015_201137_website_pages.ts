import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_pages_blocks_video_aspect" AS ENUM('16/9', '4/3', '1/1', '9/16', '21/9');
  CREATE TYPE "public"."enum_pages_blocks_embed_code_size" AS ENUM('16/9', '4/3', '1/1', '9/16', '21/9', 'fixed');
  CREATE TABLE "pages_blocks_text" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages_blocks_text_locales" (
  	"content" jsonb NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_blocks_video" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"url" varchar NOT NULL,
  	"aspect" "enum_pages_blocks_video_aspect" DEFAULT '16/9' NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages_blocks_video_locales" (
  	"caption" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_blocks_embed_code" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"size" "enum_pages_blocks_embed_code_size" DEFAULT '16/9' NOT NULL,
  	"height" numeric DEFAULT 480,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages_blocks_embed_code_locales" (
  	"title" varchar NOT NULL,
  	"caption" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_blocks_google_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"url" varchar NOT NULL,
  	"cover_id" integer,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages_blocks_google_photos_locales" (
  	"title" varchar NOT NULL,
  	"description" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages_blocks_shared_album" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"gallery_id" integer NOT NULL,
  	"block_name" varchar
  );
  
  CREATE TABLE "pages_blocks_shared_album_locales" (
  	"caption" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"slug" varchar NOT NULL,
  	"published" boolean DEFAULT false,
  	"show_in_menu" boolean DEFAULT false,
  	"menu_order" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "pages_locales" (
  	"title" varchar NOT NULL,
  	"intro" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pages_id" integer;
  ALTER TABLE "pages_blocks_text" ADD CONSTRAINT "pages_blocks_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_text_locales" ADD CONSTRAINT "pages_blocks_text_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_text"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_video" ADD CONSTRAINT "pages_blocks_video_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_video_locales" ADD CONSTRAINT "pages_blocks_video_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_video"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_embed_code" ADD CONSTRAINT "pages_blocks_embed_code_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_embed_code_locales" ADD CONSTRAINT "pages_blocks_embed_code_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_embed_code"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_google_photos" ADD CONSTRAINT "pages_blocks_google_photos_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_google_photos" ADD CONSTRAINT "pages_blocks_google_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_google_photos_locales" ADD CONSTRAINT "pages_blocks_google_photos_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_google_photos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_shared_album" ADD CONSTRAINT "pages_blocks_shared_album_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_blocks_shared_album" ADD CONSTRAINT "pages_blocks_shared_album_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_shared_album_locales" ADD CONSTRAINT "pages_blocks_shared_album_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_shared_album"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_locales" ADD CONSTRAINT "pages_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_text_order_idx" ON "pages_blocks_text" USING btree ("_order");
  CREATE INDEX "pages_blocks_text_parent_id_idx" ON "pages_blocks_text" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_text_path_idx" ON "pages_blocks_text" USING btree ("_path");
  CREATE UNIQUE INDEX "pages_blocks_text_locales_locale_parent_id_unique" ON "pages_blocks_text_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_blocks_video_order_idx" ON "pages_blocks_video" USING btree ("_order");
  CREATE INDEX "pages_blocks_video_parent_id_idx" ON "pages_blocks_video" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_video_path_idx" ON "pages_blocks_video" USING btree ("_path");
  CREATE UNIQUE INDEX "pages_blocks_video_locales_locale_parent_id_unique" ON "pages_blocks_video_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_blocks_embed_code_order_idx" ON "pages_blocks_embed_code" USING btree ("_order");
  CREATE INDEX "pages_blocks_embed_code_parent_id_idx" ON "pages_blocks_embed_code" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_embed_code_path_idx" ON "pages_blocks_embed_code" USING btree ("_path");
  CREATE UNIQUE INDEX "pages_blocks_embed_code_locales_locale_parent_id_unique" ON "pages_blocks_embed_code_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_blocks_google_photos_order_idx" ON "pages_blocks_google_photos" USING btree ("_order");
  CREATE INDEX "pages_blocks_google_photos_parent_id_idx" ON "pages_blocks_google_photos" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_google_photos_path_idx" ON "pages_blocks_google_photos" USING btree ("_path");
  CREATE INDEX "pages_blocks_google_photos_cover_idx" ON "pages_blocks_google_photos" USING btree ("cover_id");
  CREATE UNIQUE INDEX "pages_blocks_google_photos_locales_locale_parent_id_unique" ON "pages_blocks_google_photos_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_blocks_shared_album_order_idx" ON "pages_blocks_shared_album" USING btree ("_order");
  CREATE INDEX "pages_blocks_shared_album_parent_id_idx" ON "pages_blocks_shared_album" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_shared_album_path_idx" ON "pages_blocks_shared_album" USING btree ("_path");
  CREATE INDEX "pages_blocks_shared_album_gallery_idx" ON "pages_blocks_shared_album" USING btree ("gallery_id");
  CREATE UNIQUE INDEX "pages_blocks_shared_album_locales_locale_parent_id_unique" ON "pages_blocks_shared_album_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "pages_tenant_idx" ON "pages" USING btree ("tenant_id");
  CREATE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");
  CREATE INDEX "pages_published_idx" ON "pages" USING btree ("published");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE UNIQUE INDEX "pages_locales_locale_parent_id_unique" ON "pages_locales" USING btree ("_locale","_parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages_blocks_text" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_text_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_video" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_video_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_embed_code" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_embed_code_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_google_photos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_google_photos_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_shared_album" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_blocks_shared_album_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages_locales" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "pages_blocks_text" CASCADE;
  DROP TABLE "pages_blocks_text_locales" CASCADE;
  DROP TABLE "pages_blocks_video" CASCADE;
  DROP TABLE "pages_blocks_video_locales" CASCADE;
  DROP TABLE "pages_blocks_embed_code" CASCADE;
  DROP TABLE "pages_blocks_embed_code_locales" CASCADE;
  DROP TABLE "pages_blocks_google_photos" CASCADE;
  DROP TABLE "pages_blocks_google_photos_locales" CASCADE;
  DROP TABLE "pages_blocks_shared_album" CASCADE;
  DROP TABLE "pages_blocks_shared_album_locales" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "pages_locales" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pages_fk";
  
  DROP INDEX "payload_locked_documents_rels_pages_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pages_id";
  DROP TYPE "public"."enum_pages_blocks_video_aspect";
  DROP TYPE "public"."enum_pages_blocks_embed_code_size";`)
}
