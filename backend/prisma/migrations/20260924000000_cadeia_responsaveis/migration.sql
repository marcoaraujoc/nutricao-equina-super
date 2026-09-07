-- CADEIA DE RESPONSÁVEIS — todo mundo que já respondeu pelo registro, em ordem.
--
-- POR QUÊ: `tb_agendamentos_clinicos.assumido_de_id` guarda só o anterior IMEDIATO e
-- `tb_evolucoes_clinicas.autor_id` só o PRIMEIRO. Com duas ou mais assunções seguidas
-- (A criou → B assumiu → C assumiu → D assumiu), nenhum dos dois conta a história, e
-- a tela precisa dela: risca todos os que já responderam e deixa em pé só o atual.
--
-- INTEGER[] e não tabela própria: o dado é uma LISTA ORDENADA lida sempre inteira,
-- junto da linha, e nunca consultada por si (ninguém pergunta "em que registros o
-- Fulano já foi responsável" — para isso existe o AuditLog). Uma tabela de histórico
-- custaria um JOIN em toda listagem para devolver exatamente o mesmo array.
--
-- ⚠️ NÃO substitui o AuditLog: lá ficam QUEM transferiu, QUANDO e POR QUÊ. Aqui só a
-- sequência de nomes que a coluna "Responsável" desenha.
-- ⚠️ DEFAULT '{}' e NOT NULL: `array_append` em NULL devolve NULL, e a cadeia sumiria
-- silenciosamente na primeira troca de uma linha antiga.

ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"
  ADD COLUMN IF NOT EXISTS "responsaveis_anteriores" INTEGER[] NOT NULL DEFAULT '{}';

ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "responsaveis_anteriores" INTEGER[] NOT NULL DEFAULT '{}';

-- BACKFILL — semeia com o que já se sabe hoje, sem inventar o que não se sabe.
-- A evolução já assumida conhece o AUTOR (o primeiro da cadeia); o agendamento já
-- transferido conhece o ANTERIOR IMEDIATO. Quem passou por mãos INTERMEDIÁRIAS antes
-- desta migration não é reconstruído: a sequência só existe como texto no AuditLog, e
-- derivá-la de uma frase faria o sistema AFIRMAR uma cadeia que ele deduziu.
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
