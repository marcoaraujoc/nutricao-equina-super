-- Migration: 20260617000003_lote_vacina_valor_repassado
-- Adiciona valor unitário repassado ao LoteVacina (pode diferir do valorUnitario de compra)

ALTER TABLE schs2vet.tb_lotes_vacina
  ADD COLUMN IF NOT EXISTS valor_unitario_repassado DOUBLE PRECISION;
