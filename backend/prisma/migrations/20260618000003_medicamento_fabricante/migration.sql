-- AlterTable: adiciona campo fabricante ao catálogo global de medicamentos
ALTER TABLE schs2vet."tb_medicamentos" ADD COLUMN IF NOT EXISTS "fabricante" VARCHAR(150);
