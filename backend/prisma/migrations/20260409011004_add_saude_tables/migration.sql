-- CreateTable
CREATE TABLE "ApiTreino" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "hora_inicio" TEXT,
    "hora_fim" TEXT,
    "duracao" INTEGER,
    "tipo_cat" TEXT NOT NULL,
    "tipo_ex" TEXT,
    "calorias" INTEGER,
    "km" DECIMAL(8,2),
    "local_nome" TEXT,
    "descricao" TEXT,
    "obs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiTreino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLocalTreino" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiLocalTreino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiTipoExercicio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiTipoExercicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiTreino_userId_idx" ON "ApiTreino"("userId");

-- CreateIndex
CREATE INDEX "ApiTreino_data_idx" ON "ApiTreino"("data");

-- CreateIndex
CREATE UNIQUE INDEX "ApiTreino_userId_client_id_key" ON "ApiTreino"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiLocalTreino_userId_idx" ON "ApiLocalTreino"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiLocalTreino_userId_client_id_key" ON "ApiLocalTreino"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiTipoExercicio_userId_idx" ON "ApiTipoExercicio"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiTipoExercicio_userId_client_id_key" ON "ApiTipoExercicio"("userId", "client_id");

-- AddForeignKey
ALTER TABLE "ApiTreino" ADD CONSTRAINT "ApiTreino_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiLocalTreino" ADD CONSTRAINT "ApiLocalTreino_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTipoExercicio" ADD CONSTRAINT "ApiTipoExercicio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
