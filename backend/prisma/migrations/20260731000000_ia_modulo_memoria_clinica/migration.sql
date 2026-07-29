-- 1) Relatório de consumo de IA: identificar QUAL módulo originou a chamada.
--    Registros antigos ficam como 'LEGADO' (não dá para inferir a origem depois).
ALTER TABLE "schs2vet"."tb_ai_usage_logs"
  ADD COLUMN IF NOT EXISTS "modulo" VARCHAR(40) NOT NULL DEFAULT 'LEGADO';

CREATE INDEX IF NOT EXISTS "tb_ai_usage_logs_modulo_idx"
  ON "schs2vet"."tb_ai_usage_logs" ("modulo");
CREATE INDEX IF NOT EXISTS "tb_ai_usage_logs_modulo_createdAt_idx"
  ON "schs2vet"."tb_ai_usage_logs" ("modulo", "createdAt");

-- 2) Memória Clínica do Paciente: além do resumo em texto (coluna "resumo",
--    mantida para compatibilidade), guarda a estrutura navegável
--    { highlights[], topicos[] } — cada tópico ancorado na evolução que o gerou.
--    Persistir é o que evita varrer as evoluções de novo a cada abertura da tela.
ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia"
  ADD COLUMN IF NOT EXISTS "dados" JSONB;

ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia"
  ADD COLUMN IF NOT EXISTS "versao_prompt" VARCHAR(60);
