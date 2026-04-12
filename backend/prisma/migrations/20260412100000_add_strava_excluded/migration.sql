CREATE TABLE "StravaExcluded" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StravaExcluded_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StravaExcluded_userId_clientId_key" ON "StravaExcluded"("userId", "clientId");
CREATE INDEX "StravaExcluded_userId_idx" ON "StravaExcluded"("userId");
ALTER TABLE "StravaExcluded" ADD CONSTRAINT "StravaExcluded_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
