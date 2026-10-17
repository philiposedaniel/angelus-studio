import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "quotes" ADD COLUMN "contract_terms" varchar;
  ALTER TABLE "quotes" ADD COLUMN "contract_signed_name" varchar;
  ALTER TABLE "quotes" ADD COLUMN "contract_signed_at" timestamp(3) with time zone;
  ALTER TABLE "quotes" ADD COLUMN "contract_signed_ip" varchar;
  ALTER TABLE "quotes" ADD COLUMN "contract_signed_user_agent" varchar;
  ALTER TABLE "quotes" ADD COLUMN "contract_terms_fingerprint" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "quotes" DROP COLUMN "contract_terms";
  ALTER TABLE "quotes" DROP COLUMN "contract_signed_name";
  ALTER TABLE "quotes" DROP COLUMN "contract_signed_at";
  ALTER TABLE "quotes" DROP COLUMN "contract_signed_ip";
  ALTER TABLE "quotes" DROP COLUMN "contract_signed_user_agent";
  ALTER TABLE "quotes" DROP COLUMN "contract_terms_fingerprint";`)
}
