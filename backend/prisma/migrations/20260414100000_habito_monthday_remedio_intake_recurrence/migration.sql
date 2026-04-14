-- Idempotente (retry após falha / colunas já criadas). PostgreSQL 11+.
ALTER TABLE "Habito" ADD COLUMN IF NOT EXISTS "monthDay" INTEGER;
ALTER TABLE "SaudeRemedio" ADD COLUMN IF NOT EXISTS "intakeRecurrence" TEXT;
ALTER TABLE "SaudeRemedio" ADD COLUMN IF NOT EXISTS "intakeWeekdays" JSONB;
ALTER TABLE "SaudeRemedio" ADD COLUMN IF NOT EXISTS "intakeMonthDay" INTEGER;
