-- Resultado ESTRUTURADO do exame clínico (uma linha por parâmetro) — usado pelo
-- fluxo de "carregar resultado" (laboratorial: valores extraídos do laudo em forma
-- de tabela; a imagem guarda o laudo verbatim em ExameClinico.resultado + anexos).
-- Ao carregar o resultado o exame passa a status 'REALIZADO'.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_exame_clinico_resultado_itens" (
  "id"               SERIAL PRIMARY KEY,
  "exame_clinico_id" INTEGER NOT NULL,
  "parametro"        TEXT NOT NULL,
  "valor"            TEXT,
  "unidade"          VARCHAR(50),
  "referencia"       TEXT,
  "ordem"            INTEGER NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tb_exame_clinico_resultado_itens_exame_fkey"
    FOREIGN KEY ("exame_clinico_id")
    REFERENCES "schs2vet"."tb_exames_clinicos"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tb_exame_clinico_resultado_itens_exame_idx"
  ON "schs2vet"."tb_exame_clinico_resultado_itens"("exame_clinico_id");

-- Liga os anexos de imagem ao exame clínico de origem (antes só tinha animalId,
-- usado pelo fluxo nutricional). Nullable — anexos legados/nutricionais ficam sem vínculo.
ALTER TABLE "schs2vet"."tb_exame_imagem_anexos"
  ADD COLUMN IF NOT EXISTS "exame_clinico_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_exame_imagem_anexos_exame_idx"
  ON "schs2vet"."tb_exame_imagem_anexos"("exame_clinico_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tb_exame_imagem_anexos_exame_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_exame_imagem_anexos"
      ADD CONSTRAINT "tb_exame_imagem_anexos_exame_fkey"
      FOREIGN KEY ("exame_clinico_id")
      REFERENCES "schs2vet"."tb_exames_clinicos"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
