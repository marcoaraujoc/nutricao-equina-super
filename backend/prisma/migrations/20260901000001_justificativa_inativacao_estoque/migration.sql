-- Justificativa (motivo) na INATIVAÇÃO de Estoque de Vacinas e Farmácia —
-- mesma extensão de 20260901000000_justificativa_inativacao, agora para as
-- duas telas de estoque que também usam lib/cadastroAtivacao.js
-- (tabelas 'lote_vacina' e 'estoque_farmacia').

ALTER TABLE "schs2vet"."tb_lotes_vacina"   ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_estoque_clinica" ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
