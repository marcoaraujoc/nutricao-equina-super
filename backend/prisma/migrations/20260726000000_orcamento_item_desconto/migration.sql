-- Desconto por item do ORÇAMENTO: PERCENTUAL (0-100) ou VALOR (abatimento em R$
-- sobre o bruto). Mesma semântica do desconto do item de fatura — `valor_total` do
-- item passa a ser o LÍQUIDO (quantidade × valor_unitario − desconto).
ALTER TABLE "schs2vet"."tb_orcamento_itens" ADD COLUMN "desconto_tipo"  VARCHAR(12);
ALTER TABLE "schs2vet"."tb_orcamento_itens" ADD COLUMN "desconto_valor" DOUBLE PRECISION NOT NULL DEFAULT 0;
