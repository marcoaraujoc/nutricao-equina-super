-- ════════════════════════════════════════════════════════════════════════════
-- PRODUTO MULTIDOSE — o frasco que rende N aplicações (2026-09-12)
--
-- 🔴 O QUE ESTA MIGRATION RESOLVE: desde que a UNIDADE do medicamento passou a ser
-- da CLÍNICA (2026-09-12), o estoque é contado em EMBALAGENS — 10 frascos, unidade
-- "Un.". Só que a prescrição continua em mL/mg, e `mesmoGrupo('mL', 'Un.')` é FALSO:
-- sem conversão possível, `debitarEstoqueDia` cai no valor BRUTO e uma dose de 10 mL
-- debita 10 "Un." do estoque — dez frascos — e cobra dez frascos na fatura.
--
-- O dado que falta é justamente "quantas aplicações saem de um frasco". Com ele, cada
-- dose tira 1/N da embalagem e a linha da fatura sai pelo preço do frasco ÷ N — que é
-- a cobrança POR DOSE.
--
-- ⚠️ VAI EM `tb_produtos_fornecedor`, NUNCA em `tb_medicamentos`: a linha do catálogo
-- é GLOBAL na imensa maioria dos casos, e marcá-la mudaria a cobrança de TODAS as
-- clínicas do SaaS — a mesma armadilha que obrigou a unidade a nascer com
-- copy-on-write. Aqui a tabela já é da EMPRESA, com RLS de tenant direto criado em
-- `20261006000000`: nada de policy nova, nada de cópia de catálogo.
--
-- ADITIVA e SEM BACKFILL: `multidose = false` em toda linha existente = exatamente o
-- comportamento de hoje. Nenhum item passa a ser cobrado de forma diferente ao
-- aplicar esta migration; só o que a clínica marcar daqui em diante.
--
-- ⚠️ SEM `prisma generate` obrigatório: as colunas são lidas e gravadas por SQL cru
-- em `lib/produtoFornecedor.js` (§11 — no Windows o generate falha com o backend
-- rodando), e a leitura detecta a ausência delas e devolve o comportamento antigo.
-- ════════════════════════════════════════════════════════════════════════════

-- O frasco/embalagem rende mais de uma aplicação?
-- ⚠️ Booleano PRÓPRIO em vez de deduzir de `doses_por_embalagem > 1`: "não é
-- multidose" e "é multidose e ainda não informei quantas doses" são estados
-- diferentes, e o segundo precisa aparecer na tela como pendência em vez de
-- silenciosamente voltar a cobrar o frasco inteiro.
ALTER TABLE "schs2vet"."tb_produtos_fornecedor"
  ADD COLUMN IF NOT EXISTS "multidose" BOOLEAN NOT NULL DEFAULT false;

-- Quantas aplicações saem de UMA embalagem (a unidade em que o estoque é contado).
-- NULL = não informado: a regra de dose NÃO entra em vigor e a cobrança segue como
-- sempre foi. Nunca tratar NULL como 1 — 1 afirmaria "o frasco é dose única", que é
-- o oposto do que a clínica marcou.
ALTER TABLE "schs2vet"."tb_produtos_fornecedor"
  ADD COLUMN IF NOT EXISTS "doses_por_embalagem" INTEGER;
