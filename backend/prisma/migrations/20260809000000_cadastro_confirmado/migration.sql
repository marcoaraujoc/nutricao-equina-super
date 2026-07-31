-- Liberação de módulos exige o cadastro CONFIRMADO PELO PRÓPRIO usuário naquela empresa.
--
-- Antes, `cadastroCompleto` era só "tem telefone + endereço + CEP" no vínculo. Como o
-- GESTOR preenche esses campos ao incluir o membro, a pessoa entrava com os módulos já
-- liberados sem nunca ter aberto o Cadastro Pessoal — e sem conferir/completar o que a
-- clínica preencheu por ela.
--
-- `cadastro_confirmado_em` é gravado quando o PRÓPRIO usuário salva o Cadastro Pessoal
-- naquela empresa (PUT /users/me). NULL = ainda não confirmou → módulos bloqueados.
--
-- Sem backfill de propósito: todo vínculo existente passa a exigir a confirmação uma
-- vez, por empresa. É a regra pedida — cada empresa é um cadastro novo.

ALTER TABLE "schs2vet"."tb_usuario_empresa"
  ADD COLUMN IF NOT EXISTS "cadastro_confirmado_em" TIMESTAMP(3);
