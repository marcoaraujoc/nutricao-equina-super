-- ════════════════════════════════════════════════════════════════════════════
-- CORRIGE tb_prestador_especialidades: NASCEU NO PADRÃO FAIL-OPEN DA FASE 6
-- (achado por src/__tests__/rlsVarreduraTenant.test.js ao rodar a suíte depois
-- de aplicar 20261025000000_prestador_especialidades)
--
-- A migration 20261025000000 criou a policy copiando a FORMA de
-- tb_fornecedor_especialidades (20260717000000, anterior à fase 7c) —
-- `app_empresa_id() IS NULL OR <predicado>`. É o escape que a fase 7c
-- (20260806220000_fase7c_remove_escape_rls) existiu para eliminar: sessão SEM
-- contexto de tenant (`app.empresa_id` não carimbado) enxerga a TABELA INTEIRA,
-- em vez de nada.
--
-- Mesma correção já aplicada a tb_prestadores/tb_prestador_locais_trabalho/
-- tb_animal_historico em 20260906000000_fix_rls_fail_open_prestadores — troca só
-- a FORMA da policy (mesmo escopo de dono, mesma tabela-pai):
--
--     ANTES:  app_empresa_id() IS NULL OR <predicado>   (contexto ausente PERMITE)
--     AGORA:  app_plataforma() OR (<predicado>)          (contexto ausente NEGA)
--
-- ⚠️ tb_fornecedor_especialidades (a tabela-irmã que originou a cópia) CONTINUA
-- no padrão antigo — está classificada em AGUARDANDO_RLS em tenancyRls.test.js,
-- então é dívida já rastreada, não escopo desta migration.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tenant_tb_prestador_especialidades" ON "schs2vet"."tb_prestador_especialidades";
CREATE POLICY "tenant_tb_prestador_especialidades" ON "schs2vet"."tb_prestador_especialidades"
  USING (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_prestadores" p0
              WHERE p0."id" = "prestador_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())
    )
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR (
      EXISTS (SELECT 1 FROM "schs2vet"."tb_prestadores" p0
              WHERE p0."id" = "prestador_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"())
    )
  );
