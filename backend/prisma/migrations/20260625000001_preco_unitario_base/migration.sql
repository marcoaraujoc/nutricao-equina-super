-- Migration: preco_unitario_base
-- Adiciona campo preco_unitario_base em tb_estoque_clinica.
-- Armazena o preço por unidade base (R$/g ou R$/mL) calculado
-- no momento da entrada do estoque, de forma que o preço por dose
-- permaneça fixo independente do quanto já foi consumido.
-- Sem esse campo, a fórmula usava qtdEstoque atual como denominador,
-- fazendo o preço por dose aumentar progressivamente até cobrar o
-- valor total na última dose.

ALTER TABLE "schs2vet"."tb_estoque_clinica"
  ADD COLUMN "preco_unitario_base" DOUBLE PRECISION;
