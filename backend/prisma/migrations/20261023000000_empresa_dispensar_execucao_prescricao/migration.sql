-- ETAPA DE EXECUÇÃO DE PRESCRIÇÃO OPCIONAL POR EMPRESA (2026-09-24)
--
-- `dispensar_execucao_prescricao = true` → a clínica NÃO usa a tela de Execução de
-- Prescrição (plantão). O lançamento na fatura, a baixa de estoque, o recibo e a conta
-- a pagar do prestador passam a acontecer na FINALIZAÇÃO da prescrição/vacina, e o
-- documento já nasce EXECUTADO. Ver `backend/src/lib/etapaExecucaoPrescricao.js`.
--
-- ADITIVA, `DEFAULT false` e SEM BACKFILL de propósito: `false` é exatamente o
-- comportamento que toda clínica tem hoje (fatura na EXECUÇÃO). A opção NÃO nasce
-- marcada — é decisão explícita do gestor.
--
-- SEM RLS novo: `tb_empresa_configuracoes` já está escopada por empresa/equipe.

ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "dispensar_execucao_prescricao" BOOLEAN NOT NULL DEFAULT false;
