-- FORMA DE COBRANÇA DE MEDICAMENTO/VACINA (2026-09-10)
--
-- Como o item que SAI DO ESTOQUE é precificado na fatura do cliente:
--   VALOR_REPASSADO (padrão) | PERCENTUAL | MAIOR_VALOR | CUSTO_MEDIO
-- Ver `backend/src/lib/formaCobrancaEstoque.js`.
--
-- ADITIVA e SEM BACKFILL de propósito: `NULL` = VALOR_REPASSADO, que é exatamente o
-- comportamento que toda clínica tem hoje. Preencher todo mundo transformaria uma
-- suposição implícita em decisão afirmada, e nenhuma clínica escolheu nada ainda.
--
-- SEM RLS novo: `tb_empresa_configuracoes` já está escopada por empresa/equipe.

ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "forma_cobranca_estoque" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "percentual_cobranca_estoque" DOUBLE PRECISION;
