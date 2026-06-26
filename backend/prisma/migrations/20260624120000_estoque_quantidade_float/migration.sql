-- Migration: estoque_quantidade_float
-- Converte campos de quantidade de Int para Float (Double Precision) para
-- suportar valores fracionados como 3.6 kg, 0.5 L, etc.
-- Afeta: EstoqueClinica (qtdEstoque, estoqueMinimo, estoqueAlarmante),
--        MovimentoEstoque (quantidade), FaturaItem (quantidade)

ALTER TABLE "schs2vet"."tb_estoque_clinica"
  ALTER COLUMN "qtdEstoque"       TYPE DOUBLE PRECISION USING "qtdEstoque"::DOUBLE PRECISION,
  ALTER COLUMN "estoqueMinimo"    TYPE DOUBLE PRECISION USING "estoqueMinimo"::DOUBLE PRECISION,
  ALTER COLUMN "estoqueAlarmante" TYPE DOUBLE PRECISION USING "estoqueAlarmante"::DOUBLE PRECISION;

ALTER TABLE "schs2vet"."tb_movimentos_estoque"
  ALTER COLUMN "quantidade" TYPE DOUBLE PRECISION USING "quantidade"::DOUBLE PRECISION;

ALTER TABLE "schs2vet"."tb_fatura_itens"
  ALTER COLUMN "quantidade" TYPE DOUBLE PRECISION USING "quantidade"::DOUBLE PRECISION;
