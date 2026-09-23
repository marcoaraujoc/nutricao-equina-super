-- 🔴 COMO O CLIENTE QUER RECEBER A FATURA (2026-09-22, a pedido) — e-mail, WhatsApp
-- e/ou impresso. É uma ESCOLHA DELE, e pode ser mais de uma.
--
-- ONDE MORA, e por quê: `tb_proprietario_perfis` é o cadastro do CLIENTE POR EMPRESA
-- (§36). A preferência é acordada com CADA clínica — quem pede o boleto impresso na
-- clínica do haras pode querer WhatsApp na outra —, então guardá-la em `users` (que é
-- só IDENTIDADE, global) faria a escolha feita aqui reescrever a da clínica vizinha.
-- É a mesma casa de `dia_vencimento_fatura`, que é o outro campo de COBRANÇA do
-- cliente e é lido daqui por `FaturaController.diaVencimentoDoProprietario`.
--
-- CSV, não tabela de ligação nem enum[]: são no máximo 3 valores, nunca consultados
-- POR VALOR (ninguém pergunta "quem recebe por WhatsApp?" — pergunta-se a preferência
-- DE UM cliente, já carregado). É o mesmo formato de `especies_atendidas` em
-- tb_empresa_configuracoes e de `tipo_servico` em tb_prestadores.
--
-- NULL / VAZIO = TODAS AS FORMAS. É esta a razão de NÃO haver backfill: nenhum cliente
-- já cadastrado declarou preferência, e escrever uma agora seria afirmar por ele o que
-- ninguém perguntou. Mais grave, qualquer escolha diferente de "todas" TIRARIA um
-- botão de envio que a clínica usa hoje. `NULL` preserva exatamente o comportamento
-- atual até alguém abrir o cadastro e decidir.
--
-- ⚠️ TENANCY: `tb_proprietario_perfis` já está sob RLS desde a fase 7 (tenant direto
-- por `empresa_id`, FORCE ROW LEVEL SECURITY) e o `ALTER TABLE` não toca em policy
-- nenhuma — a coluna nasce protegida pela mesma regra das demais. Como é ADITIVA e sem
-- DML, também não esbarra na armadilha 42 (UPDATE de migration em tabela do tenant
-- plane não afeta nada sem `set_config('app.plataforma', ...)`).

ALTER TABLE "schs2vet"."tb_proprietario_perfis"
  ADD COLUMN IF NOT EXISTS "formas_recebimento_fatura" VARCHAR(60);

COMMENT ON COLUMN "schs2vet"."tb_proprietario_perfis"."formas_recebimento_fatura" IS
  'CSV de EMAIL|WHATSAPP|IMPRESSO — como o cliente quer receber a fatura NESTA empresa. NULL/vazio = todas.';
