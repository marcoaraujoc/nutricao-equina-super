-- Unidade da QUANTIDADE da linha da fatura (2026-10-02, a pedido).
--
-- O medicamento MULTIDOSE medido em mL passa a ser cobrado pelo que de fato saiu do
-- frasco: "Quant.: 15 mL · Unitário: R$ 5,00" em vez de "Quant.: 3 · Unitário: R$ 25,00"
-- (o preço da dose). A coluna diz EM QUÊ a quantidade está contada.
-- NULL = unidade/dose/embalagem — o significado de toda linha anterior. Sem backfill de
-- propósito: as linhas antigas guardam DOSES e marcá-las como mL afirmaria o falso.
-- DDL puro: não consulta policy de RLS, então não precisa de `app.plataforma`.
ALTER TABLE "schs2vet"."tb_fatura_itens"
  ADD COLUMN IF NOT EXISTS "unidade" VARCHAR(20);
