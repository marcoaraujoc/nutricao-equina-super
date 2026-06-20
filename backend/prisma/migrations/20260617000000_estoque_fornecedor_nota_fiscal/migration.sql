-- Add fornecedor_id and nota_fiscal to tb_estoque_clinica

ALTER TABLE schs2vet.tb_estoque_clinica
  ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER,
  ADD COLUMN IF NOT EXISTS nota_fiscal   VARCHAR(100);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'schs2vet'
      AND table_name   = 'tb_estoque_clinica'
      AND constraint_name = 'tb_estoque_clinica_fornecedor_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.tb_estoque_clinica
      ADD CONSTRAINT "tb_estoque_clinica_fornecedor_id_fkey"
      FOREIGN KEY (fornecedor_id) REFERENCES schs2vet.tb_fornecedores(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_estoque_clinica_fornecedor_id_idx"
  ON schs2vet.tb_estoque_clinica(fornecedor_id);
