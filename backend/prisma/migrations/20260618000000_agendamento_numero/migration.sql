-- Migration: agendamento_numero
-- Adiciona numero sequencial por animal ao AgendamentoClinico

ALTER TABLE schs2vet."tb_agendamentos_clinicos" ADD COLUMN "numero" INTEGER;

-- Backfill: numera cada agendamento ativo por animal em ordem cronológica
UPDATE schs2vet."tb_agendamentos_clinicos" a
SET "numero" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY animal_id ORDER BY data_hora ASC, id ASC) AS rn
  FROM schs2vet."tb_agendamentos_clinicos"
  WHERE ativo = true
) sub
WHERE a.id = sub.id;

-- Constraint única: (animal_id, numero) para sequencialidade por animal
-- Apenas para registros com numero não-nulo (ativo=false podem ficar NULL)
ALTER TABLE schs2vet."tb_agendamentos_clinicos"
  ADD CONSTRAINT "tb_agendamentos_clinicos_animal_numero_unique"
  UNIQUE NULLS NOT DISTINCT (animal_id, numero);
