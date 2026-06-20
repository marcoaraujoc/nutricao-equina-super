-- Migration: 20260617000002_lote_vacina_campos_estoque
-- Adiciona campos de gestão de estoque ao LoteVacina para o novo Módulo Vacina

ALTER TABLE schs2vet.tb_lotes_vacina
  ADD COLUMN IF NOT EXISTS doses_por_frasco   INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS qtd_frascos        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validade_horas     INTEGER,
  ADD COLUMN IF NOT EXISTS validade_dias      INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_unitario     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS data_recebimento   TIMESTAMP(3);
