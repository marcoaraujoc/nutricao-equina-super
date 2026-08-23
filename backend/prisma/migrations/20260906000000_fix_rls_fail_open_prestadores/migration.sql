-- ════════════════════════════════════════════════════════════════════════════
-- CORRIGE REGRESSÃO: 3 TABELAS AINDA NO PADRÃO FAIL-OPEN DA FASE 6
-- (achado ao investigar por que `tenancyRls.test.js` tinha tabelas fora das 3
-- listas de classificação — ver backend/src/__tests__/tenancyRls.test.js)
--
-- `tb_prestadores`      (migration 20260821000000_prestadores)
-- `tb_prestador_locais_trabalho` (migration 20260822000000_prestador_pagamento_local_acesso)
-- `tb_animal_historico` (migration 20260819000000_animal_historico)
--
-- As três já tinham ENABLE + FORCE + policy — mas escritas com o escape
-- `app_empresa_id() IS NULL OR …`, o padrão da FASE 6. A fase 7c
-- (migration 20260806220000_fase7c_remove_escape_rls) existiu especificamente
-- para ELIMINAR esse escape de todo o schema — só que as três migrations acima
-- são POSTERIORES a ela (19/21/22 de agosto vs. 06 de agosto) e aparentemente
-- copiaram um template de antes da virada.
--
-- EFEITO MEDIDO ao vivo, sem NENHUM contexto de tenant (`app.empresa_id`) setado
-- na sessão — o cenário de qualquer caminho de código que esqueça de declarar o
-- escopo (SQL cru fora de `comTenant`, script, etc.):
--
--   SELECT COUNT(*) FROM tb_prestadores;             -- devolvia 1  (deveria ser 0)
--   SELECT COUNT(*) FROM tb_animal_historico;         -- devolvia 7  (deveria ser 0)
--   SELECT COUNT(*) FROM tb_prestador_locais_trabalho; -- devolvia 0 (vazia no ambiente
--                                                          medido, mas a policy é a
--                                                          mesma forma — igualmente vulnerável)
--
-- É exatamente o vazamento "contexto ausente = vê tudo" que a fase 7c fechou nas
-- demais ~50 tabelas. Esta migration só TROCA A FORMA da policy (mesmo escopo de
-- dono, mesma tabela-pai) para o padrão fail-closed já em uso no resto do schema:
--
--     ANTES:  app_empresa_id() IS NULL OR <predicado>   (contexto ausente PERMITE)
--     AGORA:  app_plataforma() OR (<predicado>)          (contexto ausente NEGA)
--
-- Os dois caminhos que continuam vendo a linha são os mesmos de sempre: o tenant
-- dono (`comEmpresa`) e o escopo de PLATAFORMA (`comEscopoPlataforma`, ADMIN).
--
-- Gerada com o mesmo gerador da fase 7 (`scripts/gerarPoliciesRls.js`) para
-- `tb_prestadores`/`tb_prestador_locais_trabalho` (TENANT DIRETO — a coluna
-- `empresa_id` já as classifica); `tb_animal_historico` foi escrita à mão no
-- mesmo molde porque `tenancyMap.js` ainda não tem o caminho até `tb_animais`
-- declarado para ela (`CAMINHO_EXPLICITO` — ver o `PENDENTE` no próprio gerador),
-- então o script a pulou com "sem caminho até a empresa". A subconsulta abaixo é
-- a MESMA que já valia na policy antiga (20260819000000), só com o escape trocado.
--
-- ⚠️ NÃO APLICADA automaticamente — arquivo gerado para revisão. Aplicar com
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
-- (o usuário padrão do app não tem CREATE/ALTER no schema — ver CLAUDE.md §11).
-- ════════════════════════════════════════════════════════════════════════════

-- tb_prestadores — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_prestadores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prestadores" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prestadores" ON "schs2vet"."tb_prestadores";
CREATE POLICY "tenant_tb_prestadores" ON "schs2vet"."tb_prestadores"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_prestador_locais_trabalho — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prestador_locais_trabalho" ON "schs2vet"."tb_prestador_locais_trabalho";
CREATE POLICY "tenant_tb_prestador_locais_trabalho" ON "schs2vet"."tb_prestador_locais_trabalho"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_animal_historico — TENANT VIA PAI (tb_animais, por animal_id)
ALTER TABLE "schs2vet"."tb_animal_historico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_animal_historico" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_animal_historico" ON "schs2vet"."tb_animal_historico";
CREATE POLICY "tenant_tb_animal_historico" ON "schs2vet"."tb_animal_historico"
  USING (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0
              WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())
    )
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0
              WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"())
    )
  );
