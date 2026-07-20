-- Resultado de Exame · Imagem: anexos de imagem por animal.
-- A LLM interpreta cada arquivo enviado: laudo (dados extraídos) vira
-- ExameNutricional; imagem é apenas ARMAZENADA nesta tabela.

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_exame_imagem_anexos" (
  "id"          SERIAL PRIMARY KEY,
  "animalId"    INTEGER NOT NULL,
  "nome"        TEXT,
  "arquivoUrl"  TEXT NOT NULL,
  "dataExame"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "criadoPorId" INTEGER,
  "ativo"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "tb_exame_imagem_anexos_animalId_idx"
  ON "schs2vet"."tb_exame_imagem_anexos" ("animalId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_exame_imagem_anexos_animalId_fkey') THEN
    ALTER TABLE "schs2vet"."tb_exame_imagem_anexos"
      ADD CONSTRAINT "tb_exame_imagem_anexos_animalId_fkey"
      FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
