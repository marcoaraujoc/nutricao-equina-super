-- AlterTable: adiciona numero sequencial por animal
ALTER TABLE "schs2vet"."tb_exames_clinicos"
  ADD COLUMN IF NOT EXISTS "numero" INTEGER;

-- Backfill: numera os registros existentes sequencialmente por animal (ordem de solicitação)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "animalId" ORDER BY "dataSolicitacao", id) AS rn
  FROM schs2vet.tb_exames_clinicos
)
UPDATE schs2vet.tb_exames_clinicos t
SET numero = r.rn
FROM ranked r
WHERE t.id = r.id AND t.numero IS NULL;
