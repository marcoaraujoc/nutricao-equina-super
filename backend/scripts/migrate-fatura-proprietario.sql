-- Migration: fatura_por_proprietario
ALTER TABLE schs2vet.tb_faturas ADD COLUMN IF NOT EXISTS "proprietarioId" INTEGER;
ALTER TABLE schs2vet.tb_faturas ADD COLUMN IF NOT EXISTS "mesReferencia" VARCHAR(7);
ALTER TABLE schs2vet.tb_faturas ALTER COLUMN "animalId" DROP NOT NULL;
ALTER TABLE schs2vet.tb_fatura_itens ADD COLUMN IF NOT EXISTS "animalId" INTEGER;
ALTER TABLE schs2vet.tb_fatura_itens ALTER COLUMN "tipo" TYPE VARCHAR(50);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_faturas_proprietarioId_fkey') THEN
    ALTER TABLE schs2vet.tb_faturas ADD CONSTRAINT "tb_faturas_proprietarioId_fkey" FOREIGN KEY ("proprietarioId") REFERENCES schs2vet.users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_fatura_itens_animalId_fkey') THEN
    ALTER TABLE schs2vet.tb_fatura_itens ADD CONSTRAINT "tb_fatura_itens_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES schs2vet.tb_animais(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "tb_faturas_proprietarioId_status_idx" ON schs2vet.tb_faturas("proprietarioId", "status");