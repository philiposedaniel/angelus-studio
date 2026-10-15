import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_inquiries_event_type" AS ENUM('wedding', 'event', 'corporate', 'livestream', 'portrait', 'other');
  CREATE TYPE "public"."enum_inquiries_status" AS ENUM('new', 'contacted', 'quoted', 'booked', 'closed');
  CREATE TABLE "inquiries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tenant_id" integer,
  	"name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"event_type" "enum_inquiries_event_type" NOT NULL,
  	"event_date" timestamp(3) with time zone,
  	"location" varchar,
  	"message" varchar NOT NULL,
  	"locale" varchar,
  	"status" "enum_inquiries_status" DEFAULT 'new' NOT NULL,
  	"notes" varchar,
  	"sender_key" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inquiries_id" integer;
  ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "inquiries_tenant_idx" ON "inquiries" USING btree ("tenant_id");
  CREATE INDEX "inquiries_email_idx" ON "inquiries" USING btree ("email");
  CREATE INDEX "inquiries_status_idx" ON "inquiries" USING btree ("status");
  CREATE INDEX "inquiries_sender_key_idx" ON "inquiries" USING btree ("sender_key");
  CREATE INDEX "inquiries_updated_at_idx" ON "inquiries" USING btree ("updated_at");
  CREATE INDEX "inquiries_created_at_idx" ON "inquiries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inquiries_fk" FOREIGN KEY ("inquiries_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_inquiries_id_idx" ON "payload_locked_documents_rels" USING btree ("inquiries_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "inquiries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "inquiries" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_inquiries_fk";
  
  DROP INDEX "payload_locked_documents_rels_inquiries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inquiries_id";
  DROP TYPE "public"."enum_inquiries_event_type";
  DROP TYPE "public"."enum_inquiries_status";`)
}
