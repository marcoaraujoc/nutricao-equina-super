-- Migration: adiciona campo especie em tb_procedimentos_vet
-- especie = Bovino | Equino | Bovino e Equino

ALTER TABLE schs2vet.tb_procedimentos_vet
  ADD COLUMN IF NOT EXISTS especie VARCHAR(50);

CREATE INDEX IF NOT EXISTS "tb_procedimentos_vet_especie_idx"
  ON schs2vet.tb_procedimentos_vet (especie);
