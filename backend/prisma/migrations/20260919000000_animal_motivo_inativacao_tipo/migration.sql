-- ════════════════════════════════════════════════════════════════════════════
-- MOTIVO DE INATIVAÇÃO DO PACIENTE EM COLUNA PRÓPRIA (2026-08-28)
--
-- POR QUÊ: o motivo padronizado ("Falecimento", "Troca de Veterinário"…) estava
-- sendo GRAVADO JUNTO da descrição livre, numa string só, em `desativado_motivo`
-- (TEXT): `'Falecimento — no pasto'`. Isso torna o relatório de "por que perdemos
-- pacientes" impossível de indexar — agrupar exigiria `LIKE '%Falecimento%'`, e
-- curinga à ESQUERDA não usa índice B-tree: o Postgres cai em Seq Scan na tabela
-- inteira de animais, e piora à medida que a base cresce.
--
-- Com a coluna separada, o relatório vira
--   SELECT desativado_motivo_tipo, count(*)
--     FROM tb_animais WHERE ativo = false AND empresa_id = $1
--    GROUP BY 1
-- que é servido pelo índice abaixo — sem tocar nas linhas ativas.
--
-- SEMÂNTICA DAS DUAS COLUNAS (não são redundantes):
--   `desativado_motivo_tipo` → a CATEGORIA, de uma lista fechada. É o que se agrupa.
--   `desativado_motivo`      → a DESCRIÇÃO livre, opcional. É o que se lê.
-- ⚠️ Linha ANTIGA tem `tipo` NULO e o texto livre inteiro em `desativado_motivo` —
-- é assim que se reconhece o legado, e a tela compõe os dois para exibir.
--
-- ⚠️ COMPRIMENTO CONFERIDO ANTES (lição da migration `20260914000000`, em que
-- `CANCELADO_AUTOMATICAMENTE` tinha 25 caracteres numa coluna VARCHAR(20) e o cron
-- falhava toda noite): o maior valor da lista é 'Troca de Veterinário', 20
-- caracteres. VARCHAR(40) deixa folga para motivos novos sem nova migration.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "desativado_motivo_tipo" VARCHAR(40);

-- Índice do RELATÓRIO: (empresa, tipo). A empresa vem primeiro porque toda consulta
-- é escopada por tenant — é o prefixo mais seletivo e o único que o RLS garante.
--
-- ⚠️ `"empresaId"` em CAMELCASE e ENTRE ASPAS: `Animal.empresaId` não tem `@map`,
-- então a coluna real é `empresaId` — diferente da maioria das tabelas, onde é
-- `empresa_id`. Sem as aspas o Postgres dobra o identificador para minúsculas e
-- responde `column "empresaid" does not exist` (armadilha 41 do CLAUDE.md, a
-- mesma de `tb_empresa_configuracoes`).
--
-- ⚠️ NÃO é índice PARCIAL (`WHERE ativo = false`), embora só a linha inativa tenha
-- motivo. Parcial seria menor, mas o Prisma não expressa índice parcial no schema:
-- ele apareceria como DRIFT no próximo `migrate dev`, e alguém acabaria removendo-o
-- sem entender. Um índice comum já elimina o Seq Scan, que é o problema real.
CREATE INDEX IF NOT EXISTS "tb_animais_empresa_id_desativado_motivo_tipo_idx"
  ON "schs2vet"."tb_animais" ("empresaId", "desativado_motivo_tipo");

-- ── Backfill DETERMINÍSTICO ─────────────────────────────────────────────────
-- Só reclassifica o que foi gravado pelo seletor no formato `Tipo` ou `Tipo — desc`.
-- Não há adivinhação: casamento por PREFIXO EXATO do rótulo. Texto livre antigo
-- ("mudou de haras", "morreu") fica com tipo NULO de propósito — inferir categoria a
-- partir de texto solto inventaria dado num relatório que existe para ser confiável.
DO $do$
DECLARE
  m TEXT;
BEGIN
  FOREACH m IN ARRAY ARRAY['Troca de Veterinário', 'Troca de Local', 'Aposentadoria', 'Falecimento', 'Outro']
  LOOP
    UPDATE "schs2vet"."tb_animais"
       SET "desativado_motivo_tipo" = m,
           -- A descrição perde o prefixo `Tipo — `: ela passa a ser só a descrição.
           "desativado_motivo" = NULLIF(regexp_replace("desativado_motivo", '^' || m || ' — ', ''), m)
     WHERE "ativo" = false
       AND "desativado_motivo_tipo" IS NULL
       AND ("desativado_motivo" = m OR "desativado_motivo" LIKE m || ' — %');
  END LOOP;
END $do$;
