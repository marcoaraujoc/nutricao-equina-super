-- Migration: evolucao_atendimento
-- Adiciona numero, tipoAtendimento e agendamentoId à EvolucaoClinica

ALTER TABLE schs2vet."tb_evolucoes_clinicas"
  ADD COLUMN "numero"            INTEGER,
  ADD COLUMN "tipo_atendimento"  VARCHAR(2) DEFAULT 'EV',
  ADD COLUMN "agendamento_id"    INTEGER
    REFERENCES schs2vet."tb_agendamentos_clinicos"(id)
    ON DELETE SET NULL;

-- Backfill: numera evoluções ativas como EV-sequencial por animal
-- OBS: colunas sem @map no schema ficam com o nome camelCase no PG (quoted)
UPDATE schs2vet."tb_evolucoes_clinicas" e
SET
  "numero"           = sub.rn,
  "tipo_atendimento" = 'EV'
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "animalId" ORDER BY "dataInicio" ASC, id ASC) AS rn
  FROM schs2vet."tb_evolucoes_clinicas"
  WHERE ativo = true
) sub
WHERE e.id = sub.id;

-- Index para busca rápida por agendamentoId
CREATE INDEX "tb_evolucoes_clinicas_agendamento_id_idx"
  ON schs2vet."tb_evolucoes_clinicas"("agendamento_id");
