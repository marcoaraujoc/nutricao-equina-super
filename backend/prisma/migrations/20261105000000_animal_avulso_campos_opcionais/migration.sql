-- 🔴 PACIENTE AVULSO — só NOME, LOCALIZAÇÃO e E-MAIL/TELEFONE do proprietário são
-- obrigatórios (2026-10-05, a pedido). Espécie, sexo e peso deixam de ser NOT NULL
-- para que o avulso possa ser gravado sem eles. Raça já era nullable.
--
-- ⚠️ O NÃO avulso continua exigindo tudo — a regra vive na APLICAÇÃO
-- (AnimalController.criar/atualizar + tela), não na coluna.
-- ⚠️ Peso NÃO informado vai como NULL, nunca 0: a Nutrição leria 0 como dado válido.
--
-- ADITIVA e sem backfill: só relaxa restrição — nenhuma linha muda. `DROP NOT NULL`
-- é DDL, não passa por RLS (tb_animais segue sob a mesma policy).

ALTER TABLE "schs2vet"."tb_animais" ALTER COLUMN "especieId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_animais" ALTER COLUMN "sexo"      DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_animais" ALTER COLUMN "peso"      DROP NOT NULL;
