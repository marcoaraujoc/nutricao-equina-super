-- Orçamento — posologia do MEDICAMENTO (dias + frequência).
-- A quantidade cobrada continua em `quantidade` (dias × aplicações/dia); estes dois
-- campos existem para voltar preenchidos na importação para a Prescrição.
ALTER TABLE "schs2vet"."tb_orcamento_itens" ADD COLUMN "dias"       INTEGER;
ALTER TABLE "schs2vet"."tb_orcamento_itens" ADD COLUMN "frequencia" VARCHAR(50);

-- Fatura — desconto por item: PERCENTUAL (0-100) ou VALOR (abatimento em R$ sobre o bruto).
-- null/0 = sem desconto (comportamento anterior preservado nas linhas existentes).
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD COLUMN "desconto_tipo"  VARCHAR(12);
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD COLUMN "desconto_valor" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Rastreabilidade do item de orçamento tipo OUTROS lançado direto na fatura
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD COLUMN "orcamento_item_id" INTEGER;
CREATE INDEX "tb_fatura_itens_orcamento_item_id_idx" ON "schs2vet"."tb_fatura_itens"("orcamento_item_id");
ALTER TABLE "schs2vet"."tb_fatura_itens"
    ADD CONSTRAINT "tb_fatura_itens_orcamento_item_id_fkey" FOREIGN KEY ("orcamento_item_id") REFERENCES "schs2vet"."tb_orcamento_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
