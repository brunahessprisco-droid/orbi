CREATE TABLE IF NOT EXISTS "SaudeRemedio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cat" TEXT,
    "dose" TEXT,
    "stock" DOUBLE PRECISION,
    "qty" DOUBLE PRECISION,
    "days" INTEGER,
    "lastBuy" TEXT,
    "note" TEXT,
    "habitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaudeRemedio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SaudeConsumo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "name" TEXT NOT NULL,
    "dose" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaudeConsumo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SaudeRemedio_userId_clientId_key" ON "SaudeRemedio"("userId", "clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "SaudeConsumo_userId_clientId_key" ON "SaudeConsumo"("userId", "clientId");

ALTER TABLE "SaudeRemedio" DROP CONSTRAINT IF EXISTS "SaudeRemedio_userId_fkey";
ALTER TABLE "SaudeRemedio" ADD CONSTRAINT "SaudeRemedio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SaudeConsumo" DROP CONSTRAINT IF EXISTS "SaudeConsumo_userId_fkey";
ALTER TABLE "SaudeConsumo" ADD CONSTRAINT "SaudeConsumo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
