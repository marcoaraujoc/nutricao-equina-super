/*
  Warnings:

  - You are about to alter the column `tipo` on the `tb_fatura_itens` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(50)`.
  - A unique constraint covering the columns `[codigo]` on the table `tb_procedimentos_vet` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "schs2vet"."tb_prescricao_grupos_executadoPorId_idx";

-- DropIndex
DROP INDEX "schs2vet"."tb_prescricoes_medicamentoCatId_idx";

-- AlterTable
ALTER TABLE "schs2vet"."tb_estoque_clinica" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD COLUMN     "animalId" INTEGER,
ALTER COLUMN "tipo" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "schs2vet"."tb_faturas" ADD COLUMN     "mesReferencia" VARCHAR(7),
ADD COLUMN     "proprietarioId" INTEGER,
ALTER COLUMN "animalId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "schs2vet"."tb_matriz_perfis" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "schs2vet"."tb_medicamentos" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "schs2vet"."tb_perfis_equipe" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ALTER COLUMN "status" SET DATA TYPE TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "schs2vet"."tb_prescricoes" ADD COLUMN     "medicamentoCliente" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "schs2vet"."tb_procedimentos_vet" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "schs2vet"."users" ADD COLUMN     "cnpj" VARCHAR(18),
ADD COLUMN     "cpf" VARCHAR(14),
ADD COLUMN     "frequenciaVisitas" INTEGER,
ADD COLUMN     "isConvidado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mensalista" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valorAssistencia" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "schs2vet"."tb_tratadores" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "telefone" VARCHAR(30),
    "localTrabalho" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "empresaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_tratadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_reservas_estoque" (
    "id" SERIAL NOT NULL,
    "estoqueId" INTEGER NOT NULL,
    "prescricaoGrupoId" INTEGER NOT NULL,
    "animalId" INTEGER NOT NULL,
    "quantidade" DOUBLE PRECISION NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_reservas_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tb_tratadores_empresaId_idx" ON "schs2vet"."tb_tratadores"("empresaId");

-- CreateIndex
CREATE INDEX "tb_reservas_estoque_estoqueId_idx" ON "schs2vet"."tb_reservas_estoque"("estoqueId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_reservas_estoque_prescricaoGrupoId_estoqueId_key" ON "schs2vet"."tb_reservas_estoque"("prescricaoGrupoId", "estoqueId");

-- CreateIndex
CREATE INDEX "tb_faturas_proprietarioId_status_idx" ON "schs2vet"."tb_faturas"("proprietarioId", "status");

-- CreateIndex (IF NOT EXISTS — já criado por migration anterior)
CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimentos_vet_codigo_key" ON "schs2vet"."tb_procedimentos_vet"("codigo");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_faturas" ADD CONSTRAINT "tb_faturas_proprietarioId_fkey" FOREIGN KEY ("proprietarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_tratadores" ADD CONSTRAINT "tb_tratadores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque" ADD CONSTRAINT "tb_reservas_estoque_estoqueId_fkey" FOREIGN KEY ("estoqueId") REFERENCES "schs2vet"."tb_estoque_clinica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque" ADD CONSTRAINT "tb_reservas_estoque_prescricaoGrupoId_fkey" FOREIGN KEY ("prescricaoGrupoId") REFERENCES "schs2vet"."tb_prescricao_grupos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_reservas_estoque" ADD CONSTRAINT "tb_reservas_estoque_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "schs2vet"."tb_medicamento_vias_med_via_key" RENAME TO "tb_medicamento_vias_medicamentoId_via_key";

-- RenameIndex
ALTER INDEX "schs2vet"."tb_medicamentos_nome_forma_apresentacao_key" RENAME TO "tb_medicamentos_nome_formaFarmaceutica_apresentacao_key";
