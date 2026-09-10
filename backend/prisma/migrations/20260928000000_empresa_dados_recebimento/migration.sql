-- DADOS DE RECEBIMENTO da clínica (pedido de 2026-09-08): chave PIX, nome do
-- recebedor, banco, agência e conta corrente. Impressos no rodapé da FATURA — hoje o
-- cliente recebe o documento e não tem para onde pagar.
--
-- Ficam em `tb_empresas`, e não em `tb_empresa_configuracoes`: quem recebe é o
-- CNPJ/CPF que EMITE a cobrança, não a equipe que atendeu.
--
-- `pix_recebedor` existe separado do nome da empresa de propósito: a conta pode estar
-- no nome do sócio, e imprimir a razão social ali faria o cliente desconfiar do PIX.
--
-- Sem backfill: NULL = a clínica ainda não informou, e o bloco não é impresso.
-- Inventar um dado bancário seria mandar o cliente pagar no lugar errado.
--
-- `tb_empresas` é CONTROL PLANE (fora do RLS), então este DDL não precisa do
-- `set_config('app.plataforma', ...)` que o DML em tabela de tenant exige (armadilha 42).
ALTER TABLE "schs2vet"."tb_empresas"
  ADD COLUMN IF NOT EXISTS "pix_chave"      VARCHAR(140),
  ADD COLUMN IF NOT EXISTS "pix_recebedor"  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "banco"          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "agencia"        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "conta_corrente" VARCHAR(30);
