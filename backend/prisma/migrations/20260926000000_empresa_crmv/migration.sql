-- Registro do ESTABELECIMENTO no CRMV (pessoa jurídica).
--
-- Impresso no timbre de TODO documento da Central quando a clínica é CNPJ
-- (pedido de 2026-09-08). NÃO substitui o CRMV de quem assina, que é por
-- profissional e por empresa (`tb_usuario_empresa.crmv`) — a Res. CFMV
-- 1.321/2020 pede os dois registros no papel.
--
-- Sem backfill e sem default: `NULL` = a clínica ainda não informou, e a linha
-- do CRMV simplesmente não é impressa (regra do campo vazio). Preencher todo
-- mundo com qualquer coisa faria a folha AFIRMAR um registro inexistente.
--
-- `tb_empresas` é CONTROL PLANE (não está sob RLS), então este ALTER não precisa
-- do `set_config('app.plataforma', ...)` que o DML em tabela do tenant plane exige
-- (armadilha 42).
ALTER TABLE "schs2vet"."tb_empresas"
  ADD COLUMN IF NOT EXISTS "crmv" VARCHAR(30);
