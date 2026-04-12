-- CreateTable
CREATE TABLE "CasinhaAmbiente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL,
    "icone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinhaAmbiente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinhaPessoa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinhaPessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinhaTarefa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" TEXT,
    "ambiente" TEXT,
    "responsavel" TEXT,
    "prioridade" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dataVenc" TEXT,
    "horario" TEXT,
    "tempoEst" INTEGER,
    "tempoReal" INTEGER,
    "recorrencia" JSONB,
    "obs" TEXT,
    "dataConclusao" TEXT,
    "rotinaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinhaTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasinhaRotina" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "icone" TEXT,
    "tipo" TEXT,
    "ambiente" TEXT,
    "responsavel" TEXT,
    "prioridade" TEXT,
    "recorrencia" JSONB NOT NULL,
    "horario" TEXT,
    "tempoEst" INTEGER,
    "proximaData" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasinhaRotina_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CasinhaAmbiente_userId_idx" ON "CasinhaAmbiente"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinhaAmbiente_userId_client_id_key" ON "CasinhaAmbiente"("userId", "client_id");

-- CreateIndex
CREATE INDEX "CasinhaPessoa_userId_idx" ON "CasinhaPessoa"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinhaPessoa_userId_client_id_key" ON "CasinhaPessoa"("userId", "client_id");

-- CreateIndex
CREATE INDEX "CasinhaTarefa_userId_idx" ON "CasinhaTarefa"("userId");

-- CreateIndex
CREATE INDEX "CasinhaTarefa_dataVenc_idx" ON "CasinhaTarefa"("dataVenc");

-- CreateIndex
CREATE UNIQUE INDEX "CasinhaTarefa_userId_client_id_key" ON "CasinhaTarefa"("userId", "client_id");

-- CreateIndex
CREATE INDEX "CasinhaRotina_userId_idx" ON "CasinhaRotina"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CasinhaRotina_userId_client_id_key" ON "CasinhaRotina"("userId", "client_id");

-- AddForeignKey
ALTER TABLE "CasinhaAmbiente" ADD CONSTRAINT "CasinhaAmbiente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinhaPessoa" ADD CONSTRAINT "CasinhaPessoa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinhaTarefa" ADD CONSTRAINT "CasinhaTarefa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasinhaRotina" ADD CONSTRAINT "CasinhaRotina_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
