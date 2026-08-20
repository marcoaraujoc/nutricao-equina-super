-- Trilha de ATIVAÇÃO/DESATIVAÇÃO para Animal.ativo (exclusão lógica — quando
-- ativo=false o paciente some de toda tela do sistema). NÃO reutiliza
-- inativo_em/inativo_por_id: essas colunas já pertencem a um recurso DIFERENTE
-- (Animal.inativo — bloqueio de somente-leitura, migration 20260818000000, o
-- paciente CONTINUA aparecendo normalmente). Por isso os nomes aqui são
-- ativo_em/ativo_por_id (reativação) e desativado_em/desativado_por_id
-- (exclusão lógica) — ver AnimalController.excluir/reativar e
-- lib/animalAtivacao.js.
--
-- Sem FK CASCADE: excluir quem fez a ação não pode apagar nem reativar o
-- registro afetado — SET NULL preserva a data, só perde o nome de quem fez.

ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "ativo_em"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"      INTEGER,
  ADD COLUMN IF NOT EXISTS "desativado_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "desativado_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_animais_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_animais"
      ADD CONSTRAINT "tb_animais_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_animais_desativado_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_animais"
      ADD CONSTRAINT "tb_animais_desativado_por_id_fkey"
      FOREIGN KEY ("desativado_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_animais_ativo_por_id_idx"      ON "schs2vet"."tb_animais"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_animais_desativado_por_id_idx" ON "schs2vet"."tb_animais"("desativado_por_id");
