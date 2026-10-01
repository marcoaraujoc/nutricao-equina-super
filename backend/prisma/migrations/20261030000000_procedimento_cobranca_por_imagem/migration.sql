-- 2026-09-30 — Exame de IMAGEM: valor ÚNICO ou POR IMAGEM.
--
-- O pedido de exame de imagem tem "Quantidade de imagens" (tb_exames_clinicos.qtd_amostra),
-- mas o preço era sempre o do exame inteiro: 3 imagens de uma radiografia de R$ 80
-- saíam na fatura por R$ 80. Com `cobranca_por_imagem = true` o valor cadastrado
-- passa a ser o de UMA imagem e é multiplicado pela quantidade do pedido.
--
-- ADITIVA e SEM backfill: `false` = o comportamento de hoje (valor único), então
-- nenhuma cobrança existente muda.
-- ⚠️ Mora em tb_procedimentos_vet, e é por isso que só a clínica DONA da linha a
-- escreve: marcar um item GLOBAL passa pelo copy-on-write (lib/catalogoProcedimento.js),
-- como o ativar/inativar — marcar a linha global mudaria a cobrança de TODAS as clínicas.
-- DDL não consulta policy: o ALTER não precisa do carimbo de plataforma.
ALTER TABLE "schs2vet"."tb_procedimentos_vet"
  ADD COLUMN IF NOT EXISTS "cobranca_por_imagem" BOOLEAN NOT NULL DEFAULT false;
