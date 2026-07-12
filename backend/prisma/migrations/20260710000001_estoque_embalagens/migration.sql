-- Persistência da "calculadora de embalagens" da entrada de estoque:
-- permite pré-preencher Nº de Embalagens e Peso/Vol por Embalagem na edição
-- e comparar o valor POR EMBALAGEM na consolidação de entradas idênticas.
ALTER TABLE "schs2vet"."tb_estoque_clinica"
  ADD COLUMN IF NOT EXISTS "qtd_embalagens"     INTEGER,
  ADD COLUMN IF NOT EXISTS "peso_por_embalagem" DOUBLE PRECISION;
