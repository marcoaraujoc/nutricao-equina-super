-- AlterTable
ALTER TABLE "schs2vet"."tb_exames_clinicos"
  ADD COLUMN IF NOT EXISTS "qtd_amostra" INTEGER;
