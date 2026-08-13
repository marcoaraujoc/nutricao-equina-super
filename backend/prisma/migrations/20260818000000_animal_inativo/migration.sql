-- Paciente INATIVO — somente leitura, sem sumir da lista.
--
-- DIFERENTE de `ativo` (exclusão lógica — o animal SOME de tudo, inclusive do
-- proprietário). Aqui o animal CONTINUA aparecendo em /animais-vet e na tela do
-- paciente, só que travado: nenhum registro clínico novo (evolução, prescrição,
-- vacina, exame, encaminhamento, agendamento, dieta) pode ser criado, e o próprio
-- cadastro do animal não pode ser editado.
--
-- Qualquer perfil com `animais.ativar` pode INATIVAR (com motivo, obrigatório).
-- REATIVAR é sempre gestor/admin — regra fixa no controller (AnimalController.ativar),
-- não configurável pela matriz de permissões.
--
-- `inativo_por_id` sem FK CASCADE: excluir o usuário que inativou não pode apagar o
-- animal nem destravá-lo — SET NULL preserva o estado, só perde o nome de quem fez.

ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "inativo"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT,
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_animais_inativo_por_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_animais"
      ADD CONSTRAINT "tb_animais_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_animais_inativo_por_id_idx"
  ON "schs2vet"."tb_animais"("inativo_por_id");

CREATE INDEX IF NOT EXISTS "tb_animais_inativo_idx"
  ON "schs2vet"."tb_animais"("inativo");
