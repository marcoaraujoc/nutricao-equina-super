-- BACKFILL do tempo de consulta nos locais de trabalho JÁ CADASTRADOS.
--
-- A migration 20260804000000 criou `tempos_consulta` vazia. Resultado: todo local
-- cadastrado ANTES dela ficou com especialidade mas SEM tempo — e, sem tempo, a
-- Agenda não monta a grade por especialidade nem exibe os chips selecionáveis.
-- Na prática a funcionalidade só apareceria para quem reabrisse cada membro e
-- preenchesse tudo à mão, sem nenhum aviso de que isso era necessário.
--
-- Preenche 60 min para cada especialidade já registrada no local. 60 é exatamente
-- o passo que a Agenda usava antes, então NADA muda de comportamento — só passa a
-- ficar visível e ajustável pelo gestor.
UPDATE "schs2vet"."tb_membro_locais_trabalho" AS t
   SET "tempos_consulta" = sub.mapa
  FROM (
    SELECT l."id",
           jsonb_object_agg(trim(e.valor), 60) AS mapa
      FROM "schs2vet"."tb_membro_locais_trabalho" l
      CROSS JOIN LATERAL unnest(string_to_array(l."especialidadesIds", ',')) AS e(valor)
     WHERE l."especialidadesIds" IS NOT NULL
       AND l."especialidadesIds" <> ''
       AND l."tempos_consulta" IS NULL
       AND trim(e.valor) <> ''
     GROUP BY l."id"
  ) AS sub
 WHERE t."id" = sub."id";
