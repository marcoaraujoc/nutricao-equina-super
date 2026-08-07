-- ════════════════════════════════════════════════════════════════════════════
-- POLICY DE MÍDIA ESTRITA — fecha o ramo frouxo (2026-08-06)
--
-- A policy anterior tinha `empresa_id IS NULL AND animal_id IS NOT NULL`: um arquivo
-- ÓRFÃO (sem empresa) mas com `animal_id` ficava visível a QUALQUER empresa via RLS.
-- Medição no momento da troca: ZERO arquivos nessa condição (o único sem empresa é a
-- marca do produto, `publico = true`). O download já é autorizado no MidiaController
-- (`verificarAcessoAnimal`), então a rota HTTP nunca dependeu deste ramo — ele era só
-- uma folga na 2ª camada. Removida.
--
-- Nova regra: plataforma vê tudo; a empresa vê o SEU; a MARCA (sem empresa, pública)
-- todos veem. Some o "sem empresa + tem animal" — arquivo sem empresa e não-público é
-- órfão, e órfão não se serve.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "tenant_tb_midia_arquivos" ON "schs2vet"."tb_midia_arquivos";
CREATE POLICY "tenant_tb_midia_arquivos" ON "schs2vet"."tb_midia_arquivos"
  USING (
    "schs2vet"."app_plataforma"()
    OR "empresa_id" = "schs2vet"."app_empresa_id"()
    OR ("empresa_id" IS NULL AND "publico" = true)
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"()
    OR "empresa_id" = "schs2vet"."app_empresa_id"()
    OR ("empresa_id" IS NULL AND "publico" = true)
  );
