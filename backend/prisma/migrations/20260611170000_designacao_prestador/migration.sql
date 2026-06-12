-- Designação de prestador (FORNECEDOR) a animal — escopo de acesso por animal.
-- 1. Fornecedor.user_id: liga o cadastro Fornecedor à conta de login (User FORNECEDOR)
-- 2. EncaminhamentoClinico.prestador_id: prestador da equipe como destino do encaminhamento
-- 3. tb_designacoes_prestador: quais animais cada prestador pode acessar

-- ── 1. Fornecedor ↔ User ─────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_fornecedores" ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "tb_fornecedores_user_id_key"
  ON "schs2vet"."tb_fornecedores"("user_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_fornecedores_user_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_fornecedores"
      ADD CONSTRAINT "tb_fornecedores_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. Encaminhamento → prestador interno ────────────────────────────────────
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ADD COLUMN IF NOT EXISTS "prestador_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_encaminhamentos_clinicos_prestador_id_idx"
  ON "schs2vet"."tb_encaminhamentos_clinicos"("prestador_id");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_encaminhamentos_clinicos_prestador_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos"
      ADD CONSTRAINT "tb_encaminhamentos_clinicos_prestador_id_fkey"
      FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. Designações de prestador ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_designacoes_prestador" (
  "id"                SERIAL PRIMARY KEY,
  "animal_id"         INTEGER      NOT NULL,
  "prestador_id"      INTEGER      NOT NULL,
  "equipe_id"         INTEGER      NOT NULL,
  "encaminhamento_id" INTEGER,
  "motivo"            VARCHAR(255),
  "ativo"             BOOLEAN      NOT NULL DEFAULT true,
  "data_inicio"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data_fim"          TIMESTAMP(3),
  "criado_por_id"     INTEGER,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tb_designacoes_prestador_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tb_designacoes_prestador_prestador_id_fkey"
    FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tb_designacoes_prestador_equipe_id_fkey"
    FOREIGN KEY ("equipe_id") REFERENCES "schs2vet"."tb_equipes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tb_designacoes_prestador_encaminhamento_id_fkey"
    FOREIGN KEY ("encaminhamento_id") REFERENCES "schs2vet"."tb_encaminhamentos_clinicos"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tb_designacoes_prestador_criado_por_id_fkey"
    FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_designacoes_prestador_animal_id_prestador_id_equipe_id_key"
  ON "schs2vet"."tb_designacoes_prestador"("animal_id", "prestador_id", "equipe_id");

CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_prestador_id_ativo_idx"
  ON "schs2vet"."tb_designacoes_prestador"("prestador_id", "ativo");

CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_equipe_id_idx"
  ON "schs2vet"."tb_designacoes_prestador"("equipe_id");

CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_encaminhamento_id_idx"
  ON "schs2vet"."tb_designacoes_prestador"("encaminhamento_id");
