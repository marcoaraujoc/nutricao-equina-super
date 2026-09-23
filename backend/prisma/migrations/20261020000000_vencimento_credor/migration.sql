-- 🔴 DATA DE VENCIMENTO DO QUE A CLÍNICA PAGA (2026-09-22, a pedido).
--
-- O cadastro de FORNECEDOR e de PRESTADOR passa a declarar QUANDO a conta dele vence,
-- na MESMA forma do "Fechamento da Fatura" do cadastro da empresa
-- (`tb_empresa_configuracoes.tipo_fechamento` + `dia_fechamento_fatura`): uma FORMA
-- (último dia / dia fixo / n-ésimo dia útil) e um NÚMERO que só tem sentido dentro
-- dela. Duas colunas, e não uma data cheia, porque o vencimento é uma REGRA mensal —
-- gravar "05/10/2026" obrigaria a reescrever o cadastro todo mês.
--
-- ONDE MORA, e por quê: no CADASTRO do credor, não na conta. O acordo é com a pessoa
-- ("a Agrovet vence todo dia 10"), vale para todas as contas dela e muda de uma vez
-- quando é renegociado. A conta a pagar (`tb_contas_pagar`) continua guardando só o
-- que aconteceu no mês; o vencimento dela é DERIVADO daqui na leitura, como a fatura
-- deriva o dela de `tb_proprietario_perfis.dia_vencimento_fatura`.
--
-- NULL = SEM VENCIMENTO DECLARADO, e é por isso que NÃO há backfill: nenhum credor já
-- cadastrado combinou data nenhuma, e escrever uma agora afirmaria por ele o que
-- ninguém perguntou — pior, faria a conta dele nascer ATRASADA numa data inventada.
-- Sem a declaração, a tela de Pagamentos mostra "—" e a conta nunca atrasa, que é
-- exatamente o comportamento de hoje.
--
-- ⚠️ TENANCY: as duas tabelas já estão sob RLS (tenant direto por `empresa_id`, FORCE
-- ROW LEVEL SECURITY). `ALTER TABLE` é DDL e não consulta policy, e a coluna nasce
-- protegida pela mesma regra das demais. Sendo ADITIVA e sem DML, também não esbarra
-- na armadilha 42 (UPDATE de migration em tabela do tenant plane não afeta nada sem
-- `set_config('app.plataforma', ...)`).

ALTER TABLE "schs2vet"."tb_fornecedores"
  ADD COLUMN IF NOT EXISTS "tipo_vencimento" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "dia_vencimento"  INTEGER;

ALTER TABLE "schs2vet"."tb_prestadores"
  ADD COLUMN IF NOT EXISTS "tipo_vencimento" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "dia_vencimento"  INTEGER;

COMMENT ON COLUMN "schs2vet"."tb_fornecedores"."tipo_vencimento" IS
  'DIA_FIXO | DIA_UTIL | ULTIMO_DIA_MES — forma do vencimento da conta a pagar. NULL = não declarado.';
COMMENT ON COLUMN "schs2vet"."tb_fornecedores"."dia_vencimento" IS
  'Dia do mês (1-28) em DIA_FIXO, ou N-ésimo dia útil (1-10) em DIA_UTIL. NULL em ULTIMO_DIA_MES.';
COMMENT ON COLUMN "schs2vet"."tb_prestadores"."tipo_vencimento" IS
  'DIA_FIXO | DIA_UTIL | ULTIMO_DIA_MES — forma do vencimento da conta a pagar. NULL = não declarado.';
COMMENT ON COLUMN "schs2vet"."tb_prestadores"."dia_vencimento" IS
  'Dia do mês (1-28) em DIA_FIXO, ou N-ésimo dia útil (1-10) em DIA_UTIL. NULL em ULTIMO_DIA_MES.';
