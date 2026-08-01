-- Validade do ORÇAMENTO, em dias, por empresa (Configurações da empresa).
--
-- Orçamento é PROPOSTA: fica aberto esperando a decisão do cliente e, sem prazo, a
-- listagem acumula proposta de meses atrás que ninguém vai responder — e cujos preços
-- já nem valem mais. Passada a validade, o cron cancela o que não teve decisão de
-- aprovação (ver services/orcamentoCronService.js).
--
-- NULL = sem validade (comportamento de hoje: orçamento não expira). É o default de
-- propósito — colocar um prazo aqui na migration cancelaria em massa, na primeira
-- execução do cron, orçamentos que as clínicas ainda consideram vivos.

ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "validade_orcamento_dias" INTEGER;

-- O cron varre por status + data de criação, em todas as empresas.
CREATE INDEX IF NOT EXISTS "tb_orcamentos_status_created_at_idx"
  ON "schs2vet"."tb_orcamentos" ("status", "created_at");
