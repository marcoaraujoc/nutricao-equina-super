-- Orçamento de VACINA passa a capturar Tipo de Dose e Via de Aplicação — os
-- mesmos dois campos obrigatórios da tela de aplicação (SubModuloVacina) — para
-- que a importação para a Vacina já venha pronta, sem exigir preenchimento
-- manual depois de importar (antes: item vinha do orçamento sem dose/via,
-- porque o orçamento nunca os capturava).

ALTER TABLE "schs2vet"."tb_orcamento_itens"
  ADD COLUMN IF NOT EXISTS "tipo_dose" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "via"       VARCHAR(100);
