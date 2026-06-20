-- Migration: submodulos_evolucao_id
-- Adiciona evolucao_id (nullable FK) a todos os sub-módulos do atendimento
-- Nullable para não quebrar registros legados

ALTER TABLE schs2vet."tb_prescricao_grupos"
  ADD COLUMN "evolucao_id" INTEGER
    REFERENCES schs2vet."tb_evolucoes_clinicas"(id)
    ON DELETE SET NULL;

ALTER TABLE schs2vet."tb_vacinas_clinicas"
  ADD COLUMN "evolucao_id" INTEGER
    REFERENCES schs2vet."tb_evolucoes_clinicas"(id)
    ON DELETE SET NULL;

ALTER TABLE schs2vet."tb_exames_clinicos"
  ADD COLUMN "evolucao_id" INTEGER
    REFERENCES schs2vet."tb_evolucoes_clinicas"(id)
    ON DELETE SET NULL;

ALTER TABLE schs2vet."tb_encaminhamentos_clinicos"
  ADD COLUMN "evolucao_id" INTEGER
    REFERENCES schs2vet."tb_evolucoes_clinicas"(id)
    ON DELETE SET NULL;

-- Indexes para joins frequentes
CREATE INDEX "tb_prescricao_grupos_evolucao_id_idx"
  ON schs2vet."tb_prescricao_grupos"("evolucao_id");

CREATE INDEX "tb_vacinas_clinicas_evolucao_id_idx"
  ON schs2vet."tb_vacinas_clinicas"("evolucao_id");

CREATE INDEX "tb_exames_clinicos_evolucao_id_idx"
  ON schs2vet."tb_exames_clinicos"("evolucao_id");

CREATE INDEX "tb_encaminhamentos_clinicos_evolucao_id_idx"
  ON schs2vet."tb_encaminhamentos_clinicos"("evolucao_id");
