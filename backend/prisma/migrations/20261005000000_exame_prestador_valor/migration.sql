-- Exame com PRESTADOR e VALOR (2026-09-09)
--
-- 🔴 POR QUE: o exame de imagem passou a ser um PROCEDIMENTO do catálogo
-- (`tb_procedimentos_vet`, tipo IMAGEM — seed 005), e com isso ganhou preço por
-- empresa e vínculo com prestador. Faltava ao PEDIDO guardar quem executa e por
-- quanto: até aqui `lancarExameNaFatura` lançava a linha com valor ZERO, sempre.
--
-- ADITIVA e sem backfill: exame já existente fica com as duas colunas nulas e
-- continua sendo cobrado como sempre foi (valor 0). Nenhum registro muda de
-- comportamento ao aplicar.
--
-- ⚠️ `prestador_id` SEM FK, de propósito — o mesmo que `tb_prescricoes.prestador_id`:
-- prontuário não muda porque um cadastro de prestador foi excluído, e `ON DELETE SET
-- NULL` apagaria de quem era o exame. Quem guarda o vínculo de forma imutável é o
-- ledger do recibo (`tb_execucoes_procedimento_prestador`).
--
-- ⚠️ `valor_cobrado` é SNAPSHOT do preço no dia do PEDIDO, resolvido a partir do
-- vínculo do prestador (ou do valor padrão da empresa). Recalcular na leitura faria o
-- exame pedido em março ser cobrado pelo preço renegociado em setembro.
-- NULL = "não resolvido" (exame laboratorial, base sem valor cadastrado), e é
-- diferente de 0 = "gratuito" — por isso a coluna é NULÁVEL e não tem default.

ALTER TABLE "schs2vet"."tb_exames_clinicos"
  ADD COLUMN IF NOT EXISTS "prestador_id"  INTEGER,
  ADD COLUMN IF NOT EXISTS "valor_cobrado" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "tb_exames_clinicos_prestador_id_idx"
  ON "schs2vet"."tb_exames_clinicos" ("prestador_id");
