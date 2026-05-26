-- AlterTable
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD COLUMN     "titulo" VARCHAR(255);

-- CreateTable
CREATE TABLE "schs2vet"."tb_evolucao_midias" (
    "id" SERIAL NOT NULL,
    "evolucaoId" INTEGER NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "tamanho" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_evolucao_midias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_modulos_sistema" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "modulo" VARCHAR(50) NOT NULL,
    "submodulo" VARCHAR(50) NOT NULL,
    "acao" VARCHAR(50) NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "ordemExib" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tb_modulos_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_permissoes_membros" (
    "id" SERIAL NOT NULL,
    "equipeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "moduloSlug" VARCHAR(100) NOT NULL,
    "nivel" VARCHAR(20) NOT NULL DEFAULT 'LEITURA',
    "atualizadoPor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_permissoes_membros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_auditoria_permissoes" (
    "id" SERIAL NOT NULL,
    "equipeId" INTEGER NOT NULL,
    "equipeNome" VARCHAR(150) NOT NULL,
    "alvoUserId" INTEGER NOT NULL,
    "alvoUserNome" VARCHAR(255) NOT NULL,
    "alvoUserEmail" VARCHAR(255) NOT NULL,
    "moduloSlug" VARCHAR(100) NOT NULL,
    "moduloLabel" VARCHAR(150) NOT NULL,
    "nivelAnterior" VARCHAR(20),
    "nivelNovo" VARCHAR(20) NOT NULL,
    "alteradoPorId" INTEGER NOT NULL,
    "alteradoPorNome" VARCHAR(255) NOT NULL,
    "motivo" TEXT,
    "ipOrigem" VARCHAR(45),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_auditoria_permissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_permissoes_proprietarios" (
    "id" SERIAL NOT NULL,
    "equipeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "funcionalidade" VARCHAR(50) NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoPor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_permissoes_proprietarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_modulos_sistema_slug_key" ON "schs2vet"."tb_modulos_sistema"("slug");

-- CreateIndex
CREATE INDEX "tb_permissoes_membros_equipeId_userId_idx" ON "schs2vet"."tb_permissoes_membros"("equipeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_permissoes_membros_equipeId_userId_moduloSlug_key" ON "schs2vet"."tb_permissoes_membros"("equipeId", "userId", "moduloSlug");

-- CreateIndex
CREATE INDEX "tb_auditoria_permissoes_equipeId_idx" ON "schs2vet"."tb_auditoria_permissoes"("equipeId");

-- CreateIndex
CREATE INDEX "tb_auditoria_permissoes_alvoUserId_idx" ON "schs2vet"."tb_auditoria_permissoes"("alvoUserId");

-- CreateIndex
CREATE INDEX "tb_auditoria_permissoes_alteradoPorId_idx" ON "schs2vet"."tb_auditoria_permissoes"("alteradoPorId");

-- CreateIndex
CREATE INDEX "tb_auditoria_permissoes_createdAt_idx" ON "schs2vet"."tb_auditoria_permissoes"("createdAt");

-- CreateIndex
CREATE INDEX "tb_permissoes_proprietarios_equipeId_userId_idx" ON "schs2vet"."tb_permissoes_proprietarios"("equipeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_permissoes_proprietarios_equipeId_userId_funcionalidade_key" ON "schs2vet"."tb_permissoes_proprietarios"("equipeId", "userId", "funcionalidade");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_evolucao_midias" ADD CONSTRAINT "tb_evolucao_midias_evolucaoId_fkey" FOREIGN KEY ("evolucaoId") REFERENCES "schs2vet"."tb_evolucoes_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_permissoes_membros" ADD CONSTRAINT "tb_permissoes_membros_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_permissoes_membros" ADD CONSTRAINT "tb_permissoes_membros_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_permissoes_membros" ADD CONSTRAINT "tb_permissoes_membros_moduloSlug_fkey" FOREIGN KEY ("moduloSlug") REFERENCES "schs2vet"."tb_modulos_sistema"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_permissoes_proprietarios" ADD CONSTRAINT "tb_permissoes_proprietarios_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_permissoes_proprietarios" ADD CONSTRAINT "tb_permissoes_proprietarios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
