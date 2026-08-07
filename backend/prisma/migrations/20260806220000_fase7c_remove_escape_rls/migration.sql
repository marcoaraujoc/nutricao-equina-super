-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7c — O ESCAPE SAI. O ISOLAMENTO PASSA A VALER.
-- (docs/MULTI-TENANCY-PLANO.md §6, linha "7. RLS geral")
--
-- 🔴 ESTA É A MIGRATION QUE MUDA COMPORTAMENTO. As anteriores prepararam o banco; esta
-- inverte o padrão:
--
--     ANTES:  contexto ausente → PERMITE tudo   (`app_empresa_id() IS NULL OR …`)
--     AGORA:  contexto ausente → NEGA tudo      (fail-closed)
--
-- Enquanto o escape existiu, o RLS protegia apenas quem passava pelo caminho
-- instrumentado — e não havia como saber quem não passava, porque nada falhava. Com a
-- inversão, todo caminho que esquecer de declarar o escopo **quebra alto**, em vez de
-- vazar em silêncio.
--
-- ── OS DOIS ÚNICOS CAMINHOS, AMBOS EXPLÍCITOS ──────────────────────────────
--
--   TENANT     `comEmpresa(empresaId, …)` — posto no fim do `authenticate` para toda
--              requisição, e por `comTenant`/`paraCadaEmpresa` nos 8 crons.
--              → enxerga apenas aquela empresa.
--
--   PLATAFORMA `comEscopoPlataforma(…)` — leitura cross-tenant do ADMIN.
--              → enxerga tudo. É o ÚNICO caminho que atravessa clínicas.
--
--   (ausente)  → enxerga NADA.
--
-- ── POR QUE `app_plataforma()` E NÃO `BYPASSRLS` ───────────────────────────
-- Uma role com `BYPASSRLS` ignora TODAS as policies, o tempo todo, em qualquer consulta
-- — e o sintoma de conceder isso por engano é NENHUM: tudo funciona, sem isolamento.
-- A GUC é ligada por transação, por um caminho de código que tem nome e é auditável, e
-- não sobrevive ao COMMIT.
--
-- ⚠️ Superfície real do escopo de plataforma: só DUAS tabelas de ADMIN têm RLS —
-- `tb_ai_usage_logs` (consumo de IA por empresa) e `tb_assinaturas_empresa`. Monitoração,
-- planos e a lista de empresas são control plane e nem passam por policy.
--
-- ⚠️ CRON NÃO USA ESCOPO DE PLATAFORMA. Os 8 jobs de tenant PERCORREM as empresas com
-- `paraCadaEmpresa` — precisam varrer clínica a clínica, não ler todas de uma vez. Foi
-- essa distinção ("global no agendamento, por empresa na execução") que dispensou o
-- bypass para processo de fundo.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- Reaplicar as policies com o escape (`app_empresa_id() IS NULL OR …`) — o gerador
-- `scripts/gerarPoliciesRls.js` produz a forma nova; a antiga está na migration
-- 20260806180000. Ou, por tabela: `ALTER TABLE … DISABLE ROW LEVEL SECURITY`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A função do escopo de plataforma ────────────────────────────────────────
-- `STABLE` (não `IMMUTABLE`): o valor muda entre transações.
-- ⚠️ NÃO é `SECURITY DEFINER` — não precisa de privilégio, e marcá-la assim abriria uma
-- porta de escalonamento sem nenhum ganho.
CREATE OR REPLACE FUNCTION "schs2vet"."app_plataforma"()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.plataforma', true), '') = 'on';
$$;

COMMENT ON FUNCTION "schs2vet"."app_plataforma"() IS
  'true = escopo de PLATAFORMA (ADMIN cross-tenant), ligado por comEscopoPlataforma(). Local à transação.';

GRANT EXECUTE ON FUNCTION "schs2vet"."app_plataforma"() TO "zls2vetp1";

-- tb_agendamentos_clinicos — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_agendamentos_clinicos" ON "schs2vet"."tb_agendamentos_clinicos";
CREATE POLICY "tenant_tb_agendamentos_clinicos" ON "schs2vet"."tb_agendamentos_clinicos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_ai_usage_logs — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_ai_usage_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_ai_usage_logs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_ai_usage_logs" ON "schs2vet"."tb_ai_usage_logs";
CREATE POLICY "tenant_tb_ai_usage_logs" ON "schs2vet"."tb_ai_usage_logs"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_animais — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_animais" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_animais" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_animais" ON "schs2vet"."tb_animais";
CREATE POLICY "tenant_tb_animais" ON "schs2vet"."tb_animais"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_assinaturas_empresa — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_assinaturas_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_assinaturas_empresa" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_assinaturas_empresa" ON "schs2vet"."tb_assinaturas_empresa";
CREATE POLICY "tenant_tb_assinaturas_empresa" ON "schs2vet"."tb_assinaturas_empresa"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_audit_logs — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_audit_logs" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_audit_logs" ON "schs2vet"."tb_audit_logs";
CREATE POLICY "tenant_tb_audit_logs" ON "schs2vet"."tb_audit_logs"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_convites_equipe — TENANT VIA PAI (tb_equipes)
ALTER TABLE "schs2vet"."tb_convites_equipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_convites_equipe" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_convites_equipe" ON "schs2vet"."tb_convites_equipe";
CREATE POLICY "tenant_tb_convites_equipe" ON "schs2vet"."tb_convites_equipe"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_designacoes_prestador — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_designacoes_prestador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_designacoes_prestador" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_designacoes_prestador" ON "schs2vet"."tb_designacoes_prestador";
CREATE POLICY "tenant_tb_designacoes_prestador" ON "schs2vet"."tb_designacoes_prestador"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_dieta — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_dieta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_dieta" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_dieta" ON "schs2vet"."tb_dieta";
CREATE POLICY "tenant_tb_dieta" ON "schs2vet"."tb_dieta"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_empresa_configuracoes — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_empresa_configuracoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_empresa_configuracoes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_empresa_configuracoes" ON "schs2vet"."tb_empresa_configuracoes";
CREATE POLICY "tenant_tb_empresa_configuracoes" ON "schs2vet"."tb_empresa_configuracoes"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_encaminhamentos_clinicos — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_encaminhamentos_clinicos" ON "schs2vet"."tb_encaminhamentos_clinicos";
CREATE POLICY "tenant_tb_encaminhamentos_clinicos" ON "schs2vet"."tb_encaminhamentos_clinicos"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_equipes — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_equipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_equipes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_equipes" ON "schs2vet"."tb_equipes";
CREATE POLICY "tenant_tb_equipes" ON "schs2vet"."tb_equipes"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_estoque_clinica — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_estoque_clinica" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_estoque_clinica" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_estoque_clinica" ON "schs2vet"."tb_estoque_clinica";
CREATE POLICY "tenant_tb_estoque_clinica" ON "schs2vet"."tb_estoque_clinica"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_evolucao_midias — TENANT VIA PAI (tb_evolucoes_clinicas)
ALTER TABLE "schs2vet"."tb_evolucao_midias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_evolucao_midias" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_evolucao_midias" ON "schs2vet"."tb_evolucao_midias";
CREATE POLICY "tenant_tb_evolucao_midias" ON "schs2vet"."tb_evolucao_midias"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_evolucoes_clinicas" p0 WHERE p0."id" = "evolucaoId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_evolucoes_clinicas" p0 WHERE p0."id" = "evolucaoId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));

-- tb_evolucoes_clinicas — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_evolucoes_clinicas" ON "schs2vet"."tb_evolucoes_clinicas";
CREATE POLICY "tenant_tb_evolucoes_clinicas" ON "schs2vet"."tb_evolucoes_clinicas"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_exame_clinico_resultado_itens — TENANT VIA PAI (tb_exames_clinicos→tb_animais)
ALTER TABLE "schs2vet"."tb_exame_clinico_resultado_itens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_exame_clinico_resultado_itens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_exame_clinico_resultado_itens" ON "schs2vet"."tb_exame_clinico_resultado_itens";
CREATE POLICY "tenant_tb_exame_clinico_resultado_itens" ON "schs2vet"."tb_exame_clinico_resultado_itens"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_exames_clinicos" p0 WHERE p0."id" = "exame_clinico_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p1 WHERE p1."id" = p0."animalId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_exames_clinicos" p0 WHERE p0."id" = "exame_clinico_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p1 WHERE p1."id" = p0."animalId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))));

-- tb_exame_imagem_anexos — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_exame_imagem_anexos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_exame_imagem_anexos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_exame_imagem_anexos" ON "schs2vet"."tb_exame_imagem_anexos";
CREATE POLICY "tenant_tb_exame_imagem_anexos" ON "schs2vet"."tb_exame_imagem_anexos"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_exames_clinicos — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_exames_clinicos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_exames_clinicos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_exames_clinicos" ON "schs2vet"."tb_exames_clinicos";
CREATE POLICY "tenant_tb_exames_clinicos" ON "schs2vet"."tb_exames_clinicos"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_exames_nutricionais — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_exames_nutricionais" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_exames_nutricionais" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_exames_nutricionais" ON "schs2vet"."tb_exames_nutricionais";
CREATE POLICY "tenant_tb_exames_nutricionais" ON "schs2vet"."tb_exames_nutricionais"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_fatura_item_catalogo — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_fatura_item_catalogo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fatura_item_catalogo" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fatura_item_catalogo" ON "schs2vet"."tb_fatura_item_catalogo";
CREATE POLICY "tenant_tb_fatura_item_catalogo" ON "schs2vet"."tb_fatura_item_catalogo"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_fatura_itens — TENANT VIA PAI (tb_faturas)
ALTER TABLE "schs2vet"."tb_fatura_itens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fatura_itens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fatura_itens" ON "schs2vet"."tb_fatura_itens";
CREATE POLICY "tenant_tb_fatura_itens" ON "schs2vet"."tb_fatura_itens"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_faturas" p0 WHERE p0."id" = "faturaId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_faturas" p0 WHERE p0."id" = "faturaId" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));

-- tb_faturas — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_faturas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_faturas" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_faturas" ON "schs2vet"."tb_faturas";
CREATE POLICY "tenant_tb_faturas" ON "schs2vet"."tb_faturas"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_fornecedor_especialidades — TENANT VIA PAI (tb_fornecedores)
ALTER TABLE "schs2vet"."tb_fornecedor_especialidades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fornecedor_especialidades" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fornecedor_especialidades" ON "schs2vet"."tb_fornecedor_especialidades";
CREATE POLICY "tenant_tb_fornecedor_especialidades" ON "schs2vet"."tb_fornecedor_especialidades"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_fornecedores" p0 WHERE p0."id" = "fornecedor_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_fornecedores" p0 WHERE p0."id" = "fornecedor_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));

-- tb_fornecedores — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_fornecedores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fornecedores" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fornecedores" ON "schs2vet"."tb_fornecedores";
CREATE POLICY "tenant_tb_fornecedores" ON "schs2vet"."tb_fornecedores"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_ia_plano_empresa — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_ia_plano_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_ia_plano_empresa" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_ia_plano_empresa" ON "schs2vet"."tb_ia_plano_empresa";
CREATE POLICY "tenant_tb_ia_plano_empresa" ON "schs2vet"."tb_ia_plano_empresa"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_localizacoes_animal — CATÁLOGO MISTO
ALTER TABLE "schs2vet"."tb_localizacoes_animal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_localizacoes_animal" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_localizacoes_animal" ON "schs2vet"."tb_localizacoes_animal";
CREATE POLICY "tenant_tb_localizacoes_animal" ON "schs2vet"."tb_localizacoes_animal"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"() OR "empresaId" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_lotes_vacina — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_lotes_vacina" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_lotes_vacina" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_lotes_vacina" ON "schs2vet"."tb_lotes_vacina";
CREATE POLICY "tenant_tb_lotes_vacina" ON "schs2vet"."tb_lotes_vacina"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_matriz_perfis — TENANT VIA PAI (tb_perfis_equipe→tb_equipes)
ALTER TABLE "schs2vet"."tb_matriz_perfis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_matriz_perfis" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_matriz_perfis" ON "schs2vet"."tb_matriz_perfis";
CREATE POLICY "tenant_tb_matriz_perfis" ON "schs2vet"."tb_matriz_perfis"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_perfis_equipe" p0 WHERE p0."equipeId" = "equipeId" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p1 WHERE p1."id" = p0."equipeId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_perfis_equipe" p0 WHERE p0."equipeId" = "equipeId" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p1 WHERE p1."id" = p0."equipeId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))));

-- tb_medicamentos — CATÁLOGO MISTO
ALTER TABLE "schs2vet"."tb_medicamentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_medicamentos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_medicamentos" ON "schs2vet"."tb_medicamentos";
CREATE POLICY "tenant_tb_medicamentos" ON "schs2vet"."tb_medicamentos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_membro_locais_trabalho — TENANT VIA PAI (tb_membros_equipe→tb_equipes)
ALTER TABLE "schs2vet"."tb_membro_locais_trabalho" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_membro_locais_trabalho" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_membro_locais_trabalho" ON "schs2vet"."tb_membro_locais_trabalho";
CREATE POLICY "tenant_tb_membro_locais_trabalho" ON "schs2vet"."tb_membro_locais_trabalho"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_membros_equipe" p0 WHERE p0."id" = "membro_equipe_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p1 WHERE p1."id" = p0."equipeId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_membros_equipe" p0 WHERE p0."id" = "membro_equipe_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p1 WHERE p1."id" = p0."equipeId" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))));

-- tb_membros_equipe — TENANT VIA PAI (tb_equipes)
ALTER TABLE "schs2vet"."tb_membros_equipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_membros_equipe" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_membros_equipe" ON "schs2vet"."tb_membros_equipe";
CREATE POLICY "tenant_tb_membros_equipe" ON "schs2vet"."tb_membros_equipe"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_midia_arquivos — CATÁLOGO MISTO
ALTER TABLE "schs2vet"."tb_midia_arquivos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_midia_arquivos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_midia_arquivos" ON "schs2vet"."tb_midia_arquivos";
CREATE POLICY "tenant_tb_midia_arquivos" ON "schs2vet"."tb_midia_arquivos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR ("empresa_id" IS NULL AND (publico = true OR animal_id IS NOT NULL))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_movimentos_estoque — TENANT VIA PAI (tb_estoque_clinica)
ALTER TABLE "schs2vet"."tb_movimentos_estoque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_movimentos_estoque" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_movimentos_estoque" ON "schs2vet"."tb_movimentos_estoque";
CREATE POLICY "tenant_tb_movimentos_estoque" ON "schs2vet"."tb_movimentos_estoque"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_estoque_clinica" p0 WHERE p0."id" = "estoqueId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_estoque_clinica" p0 WHERE p0."id" = "estoqueId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_ocorrencias_saude — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_ocorrencias_saude" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_ocorrencias_saude" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_ocorrencias_saude" ON "schs2vet"."tb_ocorrencias_saude";
CREATE POLICY "tenant_tb_ocorrencias_saude" ON "schs2vet"."tb_ocorrencias_saude"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_orcamento_itens — TENANT VIA PAI (tb_orcamentos)
ALTER TABLE "schs2vet"."tb_orcamento_itens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_orcamento_itens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_orcamento_itens" ON "schs2vet"."tb_orcamento_itens";
CREATE POLICY "tenant_tb_orcamento_itens" ON "schs2vet"."tb_orcamento_itens"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_orcamentos" p0 WHERE p0."id" = "orcamento_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_orcamentos" p0 WHERE p0."id" = "orcamento_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));

-- tb_orcamentos — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_orcamentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_orcamentos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_orcamentos" ON "schs2vet"."tb_orcamentos";
CREATE POLICY "tenant_tb_orcamentos" ON "schs2vet"."tb_orcamentos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_perfis_equipe — TENANT VIA PAI (tb_equipes)
ALTER TABLE "schs2vet"."tb_perfis_equipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_perfis_equipe" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_perfis_equipe" ON "schs2vet"."tb_perfis_equipe";
CREATE POLICY "tenant_tb_perfis_equipe" ON "schs2vet"."tb_perfis_equipe"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_permissoes_membros — TENANT VIA PAI (tb_equipes)
ALTER TABLE "schs2vet"."tb_permissoes_membros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_permissoes_membros" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_permissoes_membros" ON "schs2vet"."tb_permissoes_membros";
CREATE POLICY "tenant_tb_permissoes_membros" ON "schs2vet"."tb_permissoes_membros"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_permissoes_proprietarios — TENANT VIA PAI (tb_equipes)
ALTER TABLE "schs2vet"."tb_permissoes_proprietarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_permissoes_proprietarios" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_permissoes_proprietarios" ON "schs2vet"."tb_permissoes_proprietarios";
CREATE POLICY "tenant_tb_permissoes_proprietarios" ON "schs2vet"."tb_permissoes_proprietarios"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_equipes" p0 WHERE p0."id" = "equipeId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_planos_dieta — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_planos_dieta" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_planos_dieta" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_planos_dieta" ON "schs2vet"."tb_planos_dieta";
CREATE POLICY "tenant_tb_planos_dieta" ON "schs2vet"."tb_planos_dieta"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_prescricao_grupos — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prescricao_grupos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prescricao_grupos" ON "schs2vet"."tb_prescricao_grupos";
CREATE POLICY "tenant_tb_prescricao_grupos" ON "schs2vet"."tb_prescricao_grupos"
  USING ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresaId" = "schs2vet"."app_empresa_id"()));

-- tb_prescricoes — TENANT VIA PAI (tb_prescricao_grupos)
ALTER TABLE "schs2vet"."tb_prescricoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prescricoes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prescricoes" ON "schs2vet"."tb_prescricoes";
CREATE POLICY "tenant_tb_prescricoes" ON "schs2vet"."tb_prescricoes"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_procedimento_combo_itens — TENANT VIA PAI (tb_procedimento_combos)
ALTER TABLE "schs2vet"."tb_procedimento_combo_itens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_procedimento_combo_itens" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_procedimento_combo_itens" ON "schs2vet"."tb_procedimento_combo_itens";
CREATE POLICY "tenant_tb_procedimento_combo_itens" ON "schs2vet"."tb_procedimento_combo_itens"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_procedimento_combos" p0 WHERE p0."id" = "combo_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_procedimento_combos" p0 WHERE p0."id" = "combo_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())));

-- tb_procedimento_combos — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_procedimento_combos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_procedimento_combos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_procedimento_combos" ON "schs2vet"."tb_procedimento_combos";
CREATE POLICY "tenant_tb_procedimento_combos" ON "schs2vet"."tb_procedimento_combos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_procedimento_valores_empresa — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_procedimento_valores_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_procedimento_valores_empresa" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_procedimento_valores_empresa" ON "schs2vet"."tb_procedimento_valores_empresa";
CREATE POLICY "tenant_tb_procedimento_valores_empresa" ON "schs2vet"."tb_procedimento_valores_empresa"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_procedimentos_vet — CATÁLOGO MISTO
ALTER TABLE "schs2vet"."tb_procedimentos_vet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_procedimentos_vet" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_procedimentos_vet" ON "schs2vet"."tb_procedimentos_vet";
CREATE POLICY "tenant_tb_procedimentos_vet" ON "schs2vet"."tb_procedimentos_vet"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_profissional_perfis — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_profissional_perfis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_profissional_perfis" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_profissional_perfis" ON "schs2vet"."tb_profissional_perfis";
CREATE POLICY "tenant_tb_profissional_perfis" ON "schs2vet"."tb_profissional_perfis"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_proprietario_localidades — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_proprietario_localidades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_proprietario_localidades" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_proprietario_localidades" ON "schs2vet"."tb_proprietario_localidades";
CREATE POLICY "tenant_tb_proprietario_localidades" ON "schs2vet"."tb_proprietario_localidades"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_proprietario_perfis — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_proprietario_perfis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_proprietario_perfis" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_proprietario_perfis" ON "schs2vet"."tb_proprietario_perfis";
CREATE POLICY "tenant_tb_proprietario_perfis" ON "schs2vet"."tb_proprietario_perfis"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_relatorios_salvos — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_relatorios_salvos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_relatorios_salvos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_relatorios_salvos" ON "schs2vet"."tb_relatorios_salvos";
CREATE POLICY "tenant_tb_relatorios_salvos" ON "schs2vet"."tb_relatorios_salvos"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_resenha_equino — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_resenha_equino" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_resenha_equino" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_resenha_equino" ON "schs2vet"."tb_resenha_equino";
CREATE POLICY "tenant_tb_resenha_equino" ON "schs2vet"."tb_resenha_equino"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_resenha_grafica — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_resenha_grafica" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_resenha_grafica" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_resenha_grafica" ON "schs2vet"."tb_resenha_grafica";
CREATE POLICY "tenant_tb_resenha_grafica" ON "schs2vet"."tb_resenha_grafica"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_resenha_traco_regiao — TENANT VIA PAI (tb_resenha_grafica→tb_animais)
ALTER TABLE "schs2vet"."tb_resenha_traco_regiao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_resenha_traco_regiao" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_resenha_traco_regiao" ON "schs2vet"."tb_resenha_traco_regiao";
CREATE POLICY "tenant_tb_resenha_traco_regiao" ON "schs2vet"."tb_resenha_traco_regiao"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_resenha_grafica" p0 WHERE p0."id" = "resenha_grafica_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p1 WHERE p1."id" = p0."animal_id" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_resenha_grafica" p0 WHERE p0."id" = "resenha_grafica_id" AND EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p1 WHERE p1."id" = p0."animal_id" AND p1."empresaId" = "schs2vet"."app_empresa_id"()))));

-- tb_reservas_estoque — TENANT VIA PAI (tb_estoque_clinica)
ALTER TABLE "schs2vet"."tb_reservas_estoque" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_reservas_estoque" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_reservas_estoque" ON "schs2vet"."tb_reservas_estoque";
CREATE POLICY "tenant_tb_reservas_estoque" ON "schs2vet"."tb_reservas_estoque"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_estoque_clinica" p0 WHERE p0."id" = "estoqueId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_estoque_clinica" p0 WHERE p0."id" = "estoqueId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- tb_resumo_atendimento_ia — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_resumo_atendimento_ia" ON "schs2vet"."tb_resumo_atendimento_ia";
CREATE POLICY "tenant_tb_resumo_atendimento_ia" ON "schs2vet"."tb_resumo_atendimento_ia"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_tratadores — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_tratadores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_tratadores" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_tratadores" ON "schs2vet"."tb_tratadores";
CREATE POLICY "tenant_tb_tratadores" ON "schs2vet"."tb_tratadores"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_usuario_especialidades — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_usuario_especialidades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_usuario_especialidades" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_usuario_especialidades" ON "schs2vet"."tb_usuario_especialidades";
CREATE POLICY "tenant_tb_usuario_especialidades" ON "schs2vet"."tb_usuario_especialidades"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_vacinas_clinicas — TENANT VIA PAI (tb_animais)
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_vacinas_clinicas" ON "schs2vet"."tb_vacinas_clinicas";
CREATE POLICY "tenant_tb_vacinas_clinicas" ON "schs2vet"."tb_vacinas_clinicas"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animalId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

