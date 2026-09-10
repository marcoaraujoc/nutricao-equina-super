-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 O `USING` do CATÁLOGO MISTO AUTORIZA O **DELETE** DA LINHA GLOBAL
--
-- A policy única `FOR ALL` (a forma usada por `tb_medicamentos`, `tb_especialidades`,
-- `tb_procedimentos_vet`, `tb_localizacoes_animal` e `tb_documento_templates`) tem:
--     USING      → plataforma OR empresa_id = tenant OR empresa_id IS NULL
--     WITH CHECK → plataforma OR empresa_id = tenant
-- O `WITH CHECK` protege INSERT e UPDATE. **DELETE não tem WITH CHECK** — ele é
-- autorizado só pelo `USING`, e ali o `OR empresa_id IS NULL` (que existe para a
-- clínica LER o catálogo do sistema) passa a autorizá-la a APAGÁ-LO.
--
-- MEDIDO em 2026-09-09, contra esta base, em transação revertida: como empresa 58,
-- `DELETE FROM tb_alimentos WHERE id = <alimento global>` apagou 1 linha. O que vinha
-- impedindo isso nas linhas reais era só a FK das composições — não a policy.
--
-- Nas outras tabelas mistas o estrago era limitado porque a exclusão delas é SOFT
-- (`ativo = false`, que é UPDATE e o WITH CHECK barra). No catálogo nutricional a
-- exclusão passou a ser HARD DELETE (migration anterior, decisão de 2026-09-09), então
-- aqui o furo apaga o catálogo do sistema de todas as clínicas.
--
-- CORREÇÃO: a policy única dá lugar a QUATRO, uma por comando. Só o SELECT enxerga o
-- global; INSERT, UPDATE e DELETE exigem ser o dono (ou a plataforma).
--
-- ⚠️ Policies do Postgres são PERMISSIVAS: somam-se com OR. Por isso a antiga precisa
-- ser DROPADA — mantê-la ao lado das novas devolveria o furo, porque o `USING` dela
-- sozinho já autorizaria o DELETE.
--
-- ⚠️ As outras cinco tabelas mistas NÃO foram tocadas aqui, de propósito: nelas a
-- exclusão é soft e a aplicação recusa a linha do sistema (400/403). Se alguma delas
-- passar a apagar de verdade, replique este arquivo para ela ANTES.
-- ════════════════════════════════════════════════════════════════════════════

-- ── tb_alimentos ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_tb_alimentos" ON "schs2vet"."tb_alimentos";

CREATE POLICY "tenant_tb_alimentos_sel" ON "schs2vet"."tb_alimentos" FOR SELECT
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL));
CREATE POLICY "tenant_tb_alimentos_ins" ON "schs2vet"."tb_alimentos" FOR INSERT
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_alimentos_upd" ON "schs2vet"."tb_alimentos" FOR UPDATE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_alimentos_del" ON "schs2vet"."tb_alimentos" FOR DELETE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- ── tb_nutrientes ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_tb_nutrientes" ON "schs2vet"."tb_nutrientes";

CREATE POLICY "tenant_tb_nutrientes_sel" ON "schs2vet"."tb_nutrientes" FOR SELECT
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL));
CREATE POLICY "tenant_tb_nutrientes_ins" ON "schs2vet"."tb_nutrientes" FOR INSERT
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_nutrientes_upd" ON "schs2vet"."tb_nutrientes" FOR UPDATE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_nutrientes_del" ON "schs2vet"."tb_nutrientes" FOR DELETE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- ── tb_composicao_alimento ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_tb_composicao_alimento" ON "schs2vet"."tb_composicao_alimento";

CREATE POLICY "tenant_tb_composicao_alimento_sel" ON "schs2vet"."tb_composicao_alimento" FOR SELECT
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL));
CREATE POLICY "tenant_tb_composicao_alimento_ins" ON "schs2vet"."tb_composicao_alimento" FOR INSERT
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_composicao_alimento_upd" ON "schs2vet"."tb_composicao_alimento" FOR UPDATE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
CREATE POLICY "tenant_tb_composicao_alimento_del" ON "schs2vet"."tb_composicao_alimento" FOR DELETE
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
