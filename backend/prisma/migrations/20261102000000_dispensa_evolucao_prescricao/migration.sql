-- PRESCRIÇÃO SEM EVOLUÇÃO, POR EMPRESA (2026-10-03)
--
-- `dispensa_evolucao_prescricao` (JSONB) = o que a clínica liberou para ser PRESCRITO
-- sem uma evolução aberta, da mesma forma que a vacina já não exige evolução:
--   { "especialidades": ["Fisioterapia"], "procedimentos": ["Ferrageamento"],
--     "classificacoes": ["Antiparasitário"] }
-- especialidade/procedimento → item PROCEDIMENTO; classificação → MEDICAMENTO
-- (`tb_medicamentos.classificacao`). Ver `backend/src/lib/dispensaEvolucaoPrescricao.js`.
--
-- ADITIVA, NULL e SEM BACKFILL de propósito: NULL = nada dispensado = TODA prescrição
-- exige evolução, que é exatamente o comportamento de hoje.
--
-- SEM RLS novo: `tb_empresa_configuracoes` já está escopada por empresa/equipe.

ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "dispensa_evolucao_prescricao" JSONB;
