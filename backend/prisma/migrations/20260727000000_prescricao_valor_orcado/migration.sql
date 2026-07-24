-- Valor NEGOCIADO no orçamento, preservado no item de prescrição importado.
-- Sem isto, o lançamento na fatura re-resolvia o preço pelo catálogo/estoque e o que
-- foi aceito pelo cliente (ex.: combo de R$ 400, procedimento de R$ 200) virava R$ 0.
ALTER TABLE "schs2vet"."tb_prescricoes" ADD COLUMN "orcamento_item_id" INTEGER;
ALTER TABLE "schs2vet"."tb_prescricoes" ADD COLUMN "valor_orcado"      DOUBLE PRECISION;

CREATE INDEX "tb_prescricoes_orcamento_item_id_idx" ON "schs2vet"."tb_prescricoes"("orcamento_item_id");

ALTER TABLE "schs2vet"."tb_prescricoes"
    ADD CONSTRAINT "tb_prescricoes_orcamento_item_id_fkey" FOREIGN KEY ("orcamento_item_id") REFERENCES "schs2vet"."tb_orcamento_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
