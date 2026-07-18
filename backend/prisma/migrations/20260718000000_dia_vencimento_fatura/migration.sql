-- Dia do mês (1-28) em que a fatura do proprietário vence. Fatura FECHADA não paga
-- após o vencimento (dia do mês seguinte ao mesReferencia) é marcada como ATRASADA
-- por um job diário.
ALTER TABLE "schs2vet"."users"
  ADD COLUMN IF NOT EXISTS "dia_vencimento_fatura" INTEGER;
