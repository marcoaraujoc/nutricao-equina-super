-- 🔴 PAGAR A FATURA POR ANIMAL (2026-09-23) — o bloco de UM paciente é ACERTADO
-- sozinho, e o que ele cobrava deixa de ser "a receber".
--
-- POR QUÊ: o fechamento por animal (migration 20261018000000) tirou o bloco do
-- `total` da fatura mas o manteve DEVIDO — em `total_fechado` —, porque fechar não é
-- receber. Faltava a outra metade do ciclo: registrar que aquele acerto à parte
-- ACONTECEU. Sem ela, o cliente que quitou o cavalo vendido seguia aparecendo
-- devendo o valor dele em "contas a receber", nos devedores e no Dashboard, para
-- sempre, e a única saída era marcar a FATURA INTEIRA como paga — cobrando por
-- tabela o que ainda está aberto dos outros pacientes.
--
-- COMO: a marca é NO ITEM (`pago_em`), pelo mesmo motivo de `fechado_em` — a
-- cobrança que chegar DEPOIS do acerto nasce ABERTA e volta a contar. Pagar um bloco
-- é sempre FECHAR + MARCAR PAGO: não existe item pago e aberto ao mesmo tempo.
--
-- ⚠️ OS TRÊS TOTAIS de `tb_faturas`, mantidos por `recalcularTotal` (lib/faturaUtils.js):
--     total             → o que a fatura AINDA cobra (itens abertos)
--     total_fechado     → bloco fechado e NÃO pago — continua DEVIDO
--     total_pago_animal → bloco já acertado à parte — NÃO é mais a receber
-- "Contas a receber"/"devedores" continuam somando `total + total_fechado` e ficam
-- certos sozinhos: o valor pago sai de `total_fechado` ao ser marcado. Quem quiser o
-- RECEBIDO (ranking de melhores pagadores) soma `total_pago_animal`.
--
-- ⚠️ ADITIVA e SEM BACKFILL: item existente nasce com `pago_em` NULO e
-- `total_pago_animal` começa em 0 em toda fatura — nenhuma fatura muda de valor nem
-- de indicador ao aplicar esta migration.

ALTER TABLE "schs2vet"."tb_fatura_itens"
  ADD COLUMN IF NOT EXISTS "pago_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pago_por_id" INTEGER;

ALTER TABLE "schs2vet"."tb_faturas"
  ADD COLUMN IF NOT EXISTS "total_pago_animal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ⚠️ `pago_por_id` fica SEM FK, mesmo precedente de `fechado_por_id`: é registro
-- HISTÓRICO de quem deu baixa no acerto e não pode virar null porque a conta dessa
-- pessoa foi excluída depois. A tela resolve o nome quando precisa e cai em "—".

-- O recorte que a tela faz o tempo todo: os itens de UM animal dentro de UMA fatura,
-- separando o que já foi acertado do que ainda não foi.
CREATE INDEX IF NOT EXISTS "tb_fatura_itens_faturaId_animalId_pago_em_idx"
  ON "schs2vet"."tb_fatura_itens" ("faturaId", "animalId", "pago_em");

-- RLS: NADA a fazer — as duas tabelas já têm policy própria e coluna nova entra sob
-- a policy existente (mesma razão de o fechamento por animal ter virado coluna e não
-- tabela nova).
