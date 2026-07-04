-- AlterTable: cache do resumo comparativo de atendimento (body-map + scores) extraído por IA
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"
  ADD COLUMN "resumo_ia_data" JSONB,
  ADD COLUMN "resumo_ia_versao" VARCHAR(50);

-- CreateIndex: lookup da evolução anterior (mesmo animal + especialidade, mais recente antes da atual)
CREATE INDEX "EvolucaoClinica_animalId_especialidade_dataInicio_idx"
  ON "schs2vet"."tb_evolucoes_clinicas" ("animalId", "especialidade", "dataInicio");
