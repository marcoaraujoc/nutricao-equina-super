-- AdditiveMigration: motivoCancelamento in PrescricaoGrupo + cargos[] in MembroEquipe

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
  ADD COLUMN IF NOT EXISTS "motivoCancelamento" TEXT;

ALTER TABLE "schs2vet"."tb_membros_equipe"
  ADD COLUMN IF NOT EXISTS "cargos" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: set cargos from existing cargo field
UPDATE "schs2vet"."tb_membros_equipe"
  SET "cargos" = ARRAY["cargo"]
  WHERE array_length("cargos", 1) IS NULL OR array_length("cargos", 1) = 0;
