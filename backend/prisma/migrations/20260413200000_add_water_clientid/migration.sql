ALTER TABLE "AlimentacaoWater" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
UPDATE "AlimentacaoWater" SET "clientId" = "id" WHERE "clientId" IS NULL;
CREATE INDEX IF NOT EXISTS "AlimentacaoWater_userId_clientId_idx" ON "AlimentacaoWater"("userId", "clientId");
