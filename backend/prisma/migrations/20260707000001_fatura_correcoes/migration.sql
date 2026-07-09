-- Rastreio de correções de fatura (módulo Relatórios):
-- incrementado sempre que um item existente é alterado ou removido
-- (FaturaController.atualizarItem/removerItem e helpers de sincronização de faturaUtils.js)
ALTER TABLE "schs2vet"."tb_faturas"
  ADD COLUMN IF NOT EXISTS "qtd_correcoes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "ultima_correcao_em" TIMESTAMP(3);
