-- Add client_id to HealthWeight using existing id as fallback for current rows
ALTER TABLE "HealthWeight" ADD COLUMN "client_id" TEXT;
UPDATE "HealthWeight" SET "client_id" = id WHERE "client_id" IS NULL;
ALTER TABLE "HealthWeight" ALTER COLUMN "client_id" SET NOT NULL;
ALTER TABLE "HealthWeight" ADD CONSTRAINT "HealthWeight_user_id_client_id_key" UNIQUE ("user_id", "client_id");
