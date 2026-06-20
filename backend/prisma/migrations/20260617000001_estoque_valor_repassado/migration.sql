-- Add valor_repassado to tb_estoque_clinica

ALTER TABLE schs2vet.tb_estoque_clinica
  ADD COLUMN IF NOT EXISTS valor_repassado DOUBLE PRECISION NOT NULL DEFAULT 0;
