CREATE TABLE "AlimentacaoWater" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "ml" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlimentacaoWater_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlimentacaoWater_userId_date_idx" ON "AlimentacaoWater"("userId", "date");

ALTER TABLE "AlimentacaoWater" ADD CONSTRAINT "AlimentacaoWater_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
