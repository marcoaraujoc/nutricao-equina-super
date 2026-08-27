-- ════════════════════════════════════════════════════════════════════════════
-- RLS em tb_auditoria_permissoes — DEFESA EM PROFUNDIDADE (2026-08-25)
--
-- POR QUÊ: a tabela guarda PII de tenant (equipeId, nome/e-mail do alvo, IP de
-- origem, quem alterou). Até aqui estava classificada como CONTROL_PLANE e sem RLS —
-- o isolamento dependia 100% da aplicação. Hoje a única leitura
-- (`PermissaoService.getAuditoriaPermissoes`) já é escopada por `equipeId` E
-- autorizada pela rota (`autorizarGestorDaEquipe`), então NÃO havia vazamento ativo.
-- Esta migration adiciona o backstop no banco para o dia em que um código novo
-- esqueça o escopo: sem RLS o vazamento seria silencioso; com RLS ele "quebra alto",
-- no espírito da fase 7c.
--
-- TENANT VIA PAI: `tb_auditoria_permissoes.equipeId` → `tb_equipes.id` → empresa.
-- Padrão fail-closed (`app_plataforma() OR EXISTS(...)`), com a coluna da tabela
-- protegida QUALIFICADA pelo próprio nome — a correção do `tb_matriz_perfis`
-- (2026-08-25): coluna nua dentro do EXISTS pode ser capturada pelo escopo interno se
-- o pai tiver coluna homônima, degenerando em predicado sempre-verdadeiro.
--
-- Reclassificada em src/lib/tenancyMap.js (CONTROL_PLANE → CAMINHO_EXPLICITO
-- 'equipeId') e em src/__tests__/tenancyRls.test.js (SEM_RLS → TENANT_PLANE).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_auditoria_permissoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_auditoria_permissoes" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_tb_auditoria_permissoes" ON "schs2vet"."tb_auditoria_permissoes";
CREATE POLICY "tenant_tb_auditoria_permissoes" ON "schs2vet"."tb_auditoria_permissoes"
  USING (
    app_plataforma()
    OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_equipes" p0
      WHERE p0."id" = "schs2vet"."tb_auditoria_permissoes"."equipeId"
        AND p0."empresaId" = app_empresa_id()
    )
  )
  WITH CHECK (
    app_plataforma()
    OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_equipes" p0
      WHERE p0."id" = "schs2vet"."tb_auditoria_permissoes"."equipeId"
        AND p0."empresaId" = app_empresa_id()
    )
  );
