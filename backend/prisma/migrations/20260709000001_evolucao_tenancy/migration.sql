-- Tenancy da evolução clínica: cada empresa/equipe vê apenas as PRÓPRIAS evoluções
-- do animal (multi-vet: o mesmo animal pode ter histórico dividido entre clínicas).
-- Sem FK — registros clínicos sobrevivem à exclusão da empresa (mesmo padrão do AuditLog).
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "equipe_id"  INTEGER;

CREATE INDEX IF NOT EXISTS "tb_evolucoes_clinicas_empresa_id_idx" ON "schs2vet"."tb_evolucoes_clinicas"("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_evolucoes_clinicas_equipe_id_idx"  ON "schs2vet"."tb_evolucoes_clinicas"("equipe_id");

-- Backfill: evoluções existentes pertencem à empresa/equipe que gerencia o animal
-- (foram criadas antes do modelo multi-vet — a equipe do animal era a única atendendo)
UPDATE "schs2vet"."tb_evolucoes_clinicas" e
SET "empresa_id" = a."empresaId",
    "equipe_id"  = a."equipeId"
FROM "schs2vet"."tb_animais" a
WHERE a.id = e."animalId"
  AND e."empresa_id" IS NULL;
