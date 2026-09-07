-- 🔴 O BACKFILL DA MIGRATION ANTERIOR NÃO SEMEOU NADA — e não avisou.
--
-- `tb_evolucoes_clinicas` e `tb_agendamentos_clinicos` estão sob RLS com **FORCE ROW
-- LEVEL SECURITY**: a policy vale até para o DONO do schema, que é quem roda as
-- migrations. Sem `app.empresa_id` nem `app.plataforma` carimbados na sessão, a policy
-- `(app_plataforma() OR empresa_id = app_empresa_id())` é falsa para toda linha — e o
-- `UPDATE` do backfill afetou ZERO delas, com sucesso e em silêncio. Medido nesta base:
-- 2 evoluções e 14 agendamentos que deveriam ter sido semeados ficaram vazios.
--
-- O `ALTER TABLE` passou porque DDL não consulta policy; só o DML é filtrado.
--
-- ⚠️ REGRA PARA TODA MIGRATION FUTURA: `UPDATE`/`INSERT`/`DELETE` em tabela do tenant
-- plane precisa carimbar o escopo ANTES — é a mesma armadilha dos crons (CLAUDE.md,
-- sessão 2026-08-23 parte 4: "dentro de paraCadaEmpresa, TUDO passa pelo tx"), e o
-- modo de falhar é o mesmo: zero linha, sem erro.
--
-- Migration NOVA em vez de corrigir a anterior: a `20260924000000` já está aplicada e
-- registrada com o seu checksum — editá-la faria o Prisma acusar migration alterada
-- depois de aplicada em todo ambiente que já a tem.

-- `true` = LOCAL à transação da migration: o carimbo morre com ela e não vaza para a
-- conexão seguinte do pool.
SELECT set_config('app.plataforma', 'on', true);

UPDATE "schs2vet"."tb_evolucoes_clinicas"
   SET "responsaveis_anteriores" = ARRAY["autor_id"]
 WHERE "autor_id" IS NOT NULL
   AND "autor_id" <> "veterinarioId"
   AND COALESCE(array_length("responsaveis_anteriores", 1), 0) = 0;

UPDATE "schs2vet"."tb_agendamentos_clinicos"
   SET "responsaveis_anteriores" = ARRAY["assumido_de_id"]
 WHERE "assumido_de_id" IS NOT NULL
   AND "assumido_de_id" IS DISTINCT FROM "veterinario_id"
   AND COALESCE(array_length("responsaveis_anteriores", 1), 0) = 0;
