-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCategoria" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiConta" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "banco" TEXT,
    "tipo" TEXT,
    "vencimento" INTEGER,
    "limite_total" DECIMAL(14,2),
    "cor" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiConta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiTransacao" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "data_lancamento" TIMESTAMP(3) NOT NULL,
    "fatura" TEXT NOT NULL,
    "categoria_nome" TEXT NOT NULL,
    "conta_nome" TEXT NOT NULL,
    "observacao" TEXT,
    "grupo_parcela_id" TEXT,
    "n_parcelas" INTEGER,
    "parcela_atual" INTEGER,
    "valor_parcela" DECIMAL(14,2),
    "conta_fixa_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiTransacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiContaFixa" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valor_padrao" DECIMAL(14,2) NOT NULL,
    "dia_venc" INTEGER,
    "categoria_nome" TEXT NOT NULL,
    "conta_nome" TEXT NOT NULL,
    "cor" TEXT,
    "encerrado_apos" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiContaFixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiContaFixaValor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fixa_client_id" TEXT NOT NULL,
    "fatura" TEXT NOT NULL,
    "valor_fatura" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiContaFixaValor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiOrcamentoConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoria_nome" TEXT NOT NULL,
    "limite_valor" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiOrcamentoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiSavingGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "saving_goal" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiSavingGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiPoupanca" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "meta" DECIMAL(14,2) NOT NULL,
    "previsto" JSONB NOT NULL,
    "realizado" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiPoupanca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiProjecaoExtra" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiProjecaoExtra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ApiCategoria_userId_idx" ON "ApiCategoria"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCategoria_userId_client_id_key" ON "ApiCategoria"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiConta_userId_idx" ON "ApiConta"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiConta_userId_client_id_key" ON "ApiConta"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiTransacao_userId_idx" ON "ApiTransacao"("userId");

-- CreateIndex
CREATE INDEX "ApiTransacao_fatura_idx" ON "ApiTransacao"("fatura");

-- CreateIndex
CREATE UNIQUE INDEX "ApiTransacao_userId_client_id_key" ON "ApiTransacao"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiContaFixa_userId_idx" ON "ApiContaFixa"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiContaFixa_userId_client_id_key" ON "ApiContaFixa"("userId", "client_id");

-- CreateIndex
CREATE INDEX "ApiContaFixaValor_userId_idx" ON "ApiContaFixaValor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiContaFixaValor_userId_fixa_client_id_fatura_key" ON "ApiContaFixaValor"("userId", "fixa_client_id", "fatura");

-- CreateIndex
CREATE INDEX "ApiOrcamentoConfig_userId_idx" ON "ApiOrcamentoConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiOrcamentoConfig_userId_categoria_nome_key" ON "ApiOrcamentoConfig"("userId", "categoria_nome");

-- CreateIndex
CREATE UNIQUE INDEX "ApiSavingGoal_userId_key" ON "ApiSavingGoal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiPoupanca_userId_key" ON "ApiPoupanca"("userId");

-- CreateIndex
CREATE INDEX "ApiProjecaoExtra_userId_idx" ON "ApiProjecaoExtra"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiProjecaoExtra_userId_client_id_key" ON "ApiProjecaoExtra"("userId", "client_id");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCategoria" ADD CONSTRAINT "ApiCategoria_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiConta" ADD CONSTRAINT "ApiConta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiTransacao" ADD CONSTRAINT "ApiTransacao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiContaFixa" ADD CONSTRAINT "ApiContaFixa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiContaFixaValor" ADD CONSTRAINT "ApiContaFixaValor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiOrcamentoConfig" ADD CONSTRAINT "ApiOrcamentoConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiSavingGoal" ADD CONSTRAINT "ApiSavingGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiPoupanca" ADD CONSTRAINT "ApiPoupanca_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiProjecaoExtra" ADD CONSTRAINT "ApiProjecaoExtra_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
