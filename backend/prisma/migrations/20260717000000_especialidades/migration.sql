-- Catálogo de especialidades por espécie (fonte única) + vínculos multi-especialidade
-- para usuários (VET/FORNECEDOR) e cadastros de Fornecedor, + espécies atendidas por empresa.

-- 1) Catálogo
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_especialidades" (
  "id"        SERIAL PRIMARY KEY,
  "nome"      VARCHAR(80) NOT NULL,
  "especie_id" INTEGER    NOT NULL,
  "ativo"     BOOLEAN     NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_especialidades_nome_especie_id_key"
  ON "schs2vet"."tb_especialidades" ("nome", "especie_id");
CREATE INDEX IF NOT EXISTS "tb_especialidades_especie_id_idx"
  ON "schs2vet"."tb_especialidades" ("especie_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_especialidades_especie_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_especialidades"
      ADD CONSTRAINT "tb_especialidades_especie_id_fkey"
      FOREIGN KEY ("especie_id") REFERENCES "schs2vet"."tb_especies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Usuário ↔ Especialidade
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_usuario_especialidades" (
  "id"               SERIAL PRIMARY KEY,
  "user_id"          INTEGER NOT NULL,
  "especialidade_id" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_usuario_especialidades_user_id_especialidade_id_key"
  ON "schs2vet"."tb_usuario_especialidades" ("user_id", "especialidade_id");
CREATE INDEX IF NOT EXISTS "tb_usuario_especialidades_user_id_idx"
  ON "schs2vet"."tb_usuario_especialidades" ("user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_usuario_especialidades_user_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_usuario_especialidades"
      ADD CONSTRAINT "tb_usuario_especialidades_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_usuario_especialidades_especialidade_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_usuario_especialidades"
      ADD CONSTRAINT "tb_usuario_especialidades_especialidade_id_fkey"
      FOREIGN KEY ("especialidade_id") REFERENCES "schs2vet"."tb_especialidades"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Fornecedor ↔ Especialidade
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_fornecedor_especialidades" (
  "id"               SERIAL PRIMARY KEY,
  "fornecedor_id"    INTEGER NOT NULL,
  "especialidade_id" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_fornecedor_especialidades_fornecedor_id_especialidade_id_key"
  ON "schs2vet"."tb_fornecedor_especialidades" ("fornecedor_id", "especialidade_id");
CREATE INDEX IF NOT EXISTS "tb_fornecedor_especialidades_fornecedor_id_idx"
  ON "schs2vet"."tb_fornecedor_especialidades" ("fornecedor_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_fornecedor_especialidades_fornecedor_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_fornecedor_especialidades"
      ADD CONSTRAINT "tb_fornecedor_especialidades_fornecedor_id_fkey"
      FOREIGN KEY ("fornecedor_id") REFERENCES "schs2vet"."tb_fornecedores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_fornecedor_especialidades_especialidade_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_fornecedor_especialidades"
      ADD CONSTRAINT "tb_fornecedor_especialidades_especialidade_id_fkey"
      FOREIGN KEY ("especialidade_id") REFERENCES "schs2vet"."tb_especialidades"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) Espécies atendidas por empresa (CSV de IDs de espécie)
ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "especies_atendidas" TEXT;
