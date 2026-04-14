-- AlterTable Habito: dia do mês para hábitos com frequência mensal (fase 1 — API + schema)
ALTER TABLE "Habito" ADD COLUMN "monthDay" INTEGER;

-- AlterTable SaudeRemedio: recorrência de uso (diario / semanal / mensal) + detalhes
ALTER TABLE "SaudeRemedio" ADD COLUMN "intakeRecurrence" TEXT;
ALTER TABLE "SaudeRemedio" ADD COLUMN "intakeWeekdays" JSONB;
ALTER TABLE "SaudeRemedio" ADD COLUMN "intakeMonthDay" INTEGER;
