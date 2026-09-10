-- ════════════════════════════════════════════════════════════════════════════
-- PRESTADOR E OS DOIS VALORES NO COMBO (2026-09-10)
--
-- O combo de procedimentos tinha UM valor (`valor`) e nenhum prestador — mesma lacuna
-- que `tb_procedimento_prestadores` acabou de fechar para o procedimento avulso. Um
-- pacote executado por um ferrador externo não tinha onde registrar quem o executa nem
-- quanto ELE cobra da clínica.
--
-- 🔴 `valor` NÃO é renomeado. Ele já era, e continua sendo, o **Valor Cliente** — o
-- preço do pacote para o cliente. Renomear a coluna obrigaria a tocar todos os
-- leitores (`resolverValorProcedimento`, Orçamento, Prescrição, os dois
-- renderizadores) para não ganhar nada: o que mudou é o RÓTULO na tela.
--
-- Duas colunas novas, ADITIVAS:
--   • `prestador_id`    — quem executa o pacote. Sem FK, pela mesma razão de
--     `tb_prescricoes.prestador_id`: o combo é configuração de preço e não pode ser
--     alterado porque um cadastro de prestador foi excluído. A validação de que o
--     prestador é DESTA empresa é da aplicação (o RLS não cruza tabelas).
--   • `valor_prestador` — o que ELE cobra da clínica pelo pacote. Vai ao recibo quando
--     o tipo de pagamento do prestador é POR_PROCEDIMENTO.
--
-- Sem backfill: combo existente fica sem prestador (`NULL`), que é o estado correto —
-- é executado pela própria equipe até alguém dizer o contrário. Nenhum preço muda.
--
-- ⚠️ `tb_procedimento_combos` já está no tenant plane (RLS de TENANT DIRETO desde a
-- fase 7): não há policy nova a criar. `ADD COLUMN` é DDL e não passa pela policy.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_procedimento_combos"
  ADD COLUMN IF NOT EXISTS "prestador_id"    INTEGER,
  ADD COLUMN IF NOT EXISTS "valor_prestador" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "tb_procedimento_combos_prestador_id_idx"
  ON "schs2vet"."tb_procedimento_combos" ("prestador_id");
