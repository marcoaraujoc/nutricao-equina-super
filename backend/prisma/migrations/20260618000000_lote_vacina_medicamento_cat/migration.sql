-- Migration: 20260618000000_lote_vacina_medicamento_cat
-- LoteVacina passa a referenciar tb_medicamentos (novo catálogo) em vez de tb_vacinas.
-- vacina_id torna-se opcional para permitir lotes criados pelo novo fluxo.

-- 1. Torna vacina_id opcional
ALTER TABLE schs2vet.tb_lotes_vacina
  ALTER COLUMN vacina_id DROP NOT NULL;

-- 2. Adiciona FK para o novo catálogo de medicamentos
ALTER TABLE schs2vet.tb_lotes_vacina
  ADD COLUMN IF NOT EXISTS medicamento_cat_id INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_lotes_vacina_medicamento_cat_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.tb_lotes_vacina
      ADD CONSTRAINT tb_lotes_vacina_medicamento_cat_id_fkey
      FOREIGN KEY (medicamento_cat_id)
      REFERENCES schs2vet.tb_medicamentos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tb_lotes_vacina_medicamento_cat_id_idx
  ON schs2vet.tb_lotes_vacina(medicamento_cat_id);
