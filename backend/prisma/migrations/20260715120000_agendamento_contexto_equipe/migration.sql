-- Contexto (empresa/equipe) do agendamento — agendas independentes por equipe.
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "equipe_id"  INTEGER;

CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_empresa_id_data_hora_idx"
  ON "schs2vet"."tb_agendamentos_clinicos" ("empresa_id", "data_hora");
CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_equipe_id_data_hora_idx"
  ON "schs2vet"."tb_agendamentos_clinicos" ("equipe_id", "data_hora");

-- Backfill: agendamentos existentes herdam o contexto do animal (preserva comportamento atual).
UPDATE "schs2vet"."tb_agendamentos_clinicos" ag
SET "empresa_id" = a."empresaId", "equipe_id" = a."equipeId"
FROM "schs2vet"."tb_animais" a
WHERE ag."animal_id" = a."id" AND ag."empresa_id" IS NULL;
