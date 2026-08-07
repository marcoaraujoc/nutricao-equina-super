-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7 — CORREÇÃO: a policy de `tb_prescricoes` usava OR entre DOIS caminhos
--
-- 🔴 VAZAMENTO ENCONTRADO PELA MEDIÇÃO, não pela leitura do código.
--
-- `tb_prescricoes` declara dois caminhos até a empresa (`grupoId` e `animalId`), e a
-- primeira versão do gerador emitiu a policy como `caminho1 OR caminho2`. Isso está
-- CERTO para detectar órfã ("tem dono se qualquer rota resolver") e ERRADO para uma
-- policy ("visível se qualquer rota casar"): quando os dois pais discordam, a linha
-- aparece para AS DUAS empresas.
--
-- Como apareceu: ao contar as linhas visíveis por empresa, `tb_prescricoes` somou 61
-- numa tabela de 59 — duas contadas duas vezes. São as prescrições 83 e 84, cujo GRUPO
-- é da empresa 35 e cujo ANIMAL é da 31 (legado do tratamento entre clínicas, que a
-- fase 3 encerrou). Sem essa conferência, o `OR` teria passado despercebido: nenhuma
-- consulta falha, nada dá erro — a linha só fica visível para quem não deveria vê-la.
--
-- A policy passa a usar SÓ o caminho AUTORITATIVO: o GRUPO, que é onde `empresaId` é
-- gravado na criação do documento. Seguro: as 59 prescrições têm `grupoId` preenchido,
-- então nenhuma linha fica invisível.
--
-- ⚠️ O gerador agora EMITE AVISO sempre que uma tabela tiver mais de um caminho
-- declarado, para que a escolha do autoritativo seja consciente e não silenciosa.
-- ════════════════════════════════════════════════════════════════════════════

-- tb_prescricoes — TENANT VIA PAI (tb_prescricao_grupos)
ALTER TABLE "schs2vet"."tb_prescricoes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prescricoes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prescricoes" ON "schs2vet"."tb_prescricoes";
CREATE POLICY "tenant_tb_prescricoes" ON "schs2vet"."tb_prescricoes"
  USING ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"()));
