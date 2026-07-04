-- Atrela Fornecedor, Tratador e LocalizacaoAnimal a empresa/equipe (mesmo padrão de Animal).
-- empresaId: sem FK, mesmo padrão de tb_fornecedores.empresa_id (sobrevive à exclusão da empresa).
-- equipeId: FK ON DELETE SET NULL, mesmo padrão de tb_animais.equipeId.
-- SYSTEM e registros legados continuam com empresaId/equipeId NULL = visíveis para todos.

-- ── tb_tratadores ────────────────────────────────────────────────────────────

ALTER TABLE "schs2vet"."tb_tratadores" ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;
ALTER TABLE "schs2vet"."tb_tratadores" ADD COLUMN IF NOT EXISTS "equipe_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_tratadores_equipe_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_tratadores"
      ADD CONSTRAINT "tb_tratadores_equipe_id_fkey"
      FOREIGN KEY ("equipe_id") REFERENCES "schs2vet"."tb_equipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_tratadores_empresa_id_idx" ON "schs2vet"."tb_tratadores"("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_tratadores_equipe_id_idx"  ON "schs2vet"."tb_tratadores"("equipe_id");

-- Unicidade global (nome, localizacao_id) não faz mais sentido multi-empresa.
-- Duplicidade passa a ser checada em app-level, escopada por empresa (igual Fornecedor).
ALTER TABLE "schs2vet"."tb_tratadores" DROP CONSTRAINT IF EXISTS "unique_tratador_nome_local";

-- ── tb_fornecedores ──────────────────────────────────────────────────────────

ALTER TABLE "schs2vet"."tb_fornecedores" ADD COLUMN IF NOT EXISTS "equipe_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_fornecedores_equipe_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_fornecedores"
      ADD CONSTRAINT "tb_fornecedores_equipe_id_fkey"
      FOREIGN KEY ("equipe_id") REFERENCES "schs2vet"."tb_equipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_fornecedores_equipe_id_idx" ON "schs2vet"."tb_fornecedores"("equipe_id");

-- ── tb_localizacoes_animal (colunas camelCase, mesmo padrão de tb_animais) ─────

ALTER TABLE "schs2vet"."tb_localizacoes_animal" ADD COLUMN IF NOT EXISTS "empresaId" INTEGER;
ALTER TABLE "schs2vet"."tb_localizacoes_animal" ADD COLUMN IF NOT EXISTS "equipeId" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_localizacoes_animal_equipeId_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_localizacoes_animal"
      ADD CONSTRAINT "tb_localizacoes_animal_equipeId_fkey"
      FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_localizacoes_animal_empresaId_idx" ON "schs2vet"."tb_localizacoes_animal"("empresaId");
CREATE INDEX IF NOT EXISTS "tb_localizacoes_animal_equipeId_idx" ON "schs2vet"."tb_localizacoes_animal"("equipeId");

-- Unicidade global de nome não faz mais sentido multi-empresa (duas empresas podem ter
-- uma localização com o mesmo nome). Duplicidade passa a ser checada em app-level, escopada.
ALTER TABLE "schs2vet"."tb_localizacoes_animal" DROP CONSTRAINT IF EXISTS "tb_localizacoes_animal_nome_key";
