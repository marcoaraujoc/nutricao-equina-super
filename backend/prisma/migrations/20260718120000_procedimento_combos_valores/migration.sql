-- Cadastro > Procedimentos: valor de venda POR EMPRESA (sobrepõe o valorVenda do
-- catálogo ADMIN) e combos de procedimentos POR EMPRESA (pacote com valor próprio).

-- 1) Valor por empresa
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_procedimento_valores_empresa" (
  "id"              SERIAL PRIMARY KEY,
  "empresa_id"      INTEGER NOT NULL,
  "procedimento_id" INTEGER NOT NULL,
  "valor"           DOUBLE PRECISION NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimento_valores_empresa_empresa_id_procedimento_id_key"
  ON "schs2vet"."tb_procedimento_valores_empresa" ("empresa_id", "procedimento_id");
CREATE INDEX IF NOT EXISTS "tb_procedimento_valores_empresa_empresa_id_idx"
  ON "schs2vet"."tb_procedimento_valores_empresa" ("empresa_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_procedimento_valores_empresa_empresa_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_procedimento_valores_empresa"
      ADD CONSTRAINT "tb_procedimento_valores_empresa_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_procedimento_valores_empresa_procedimento_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_procedimento_valores_empresa"
      ADD CONSTRAINT "tb_procedimento_valores_empresa_procedimento_id_fkey"
      FOREIGN KEY ("procedimento_id") REFERENCES "schs2vet"."tb_procedimentos_vet"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Combos por empresa
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_procedimento_combos" (
  "id"         SERIAL PRIMARY KEY,
  "empresa_id" INTEGER NOT NULL,
  "nome"       VARCHAR(255) NOT NULL,
  "descricao"  TEXT,
  "valor"      DOUBLE PRECISION NOT NULL,
  "ativo"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimento_combos_empresa_id_nome_key"
  ON "schs2vet"."tb_procedimento_combos" ("empresa_id", "nome");
CREATE INDEX IF NOT EXISTS "tb_procedimento_combos_empresa_id_idx"
  ON "schs2vet"."tb_procedimento_combos" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_procedimento_combos_ativo_idx"
  ON "schs2vet"."tb_procedimento_combos" ("ativo");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_procedimento_combos_empresa_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_procedimento_combos"
      ADD CONSTRAINT "tb_procedimento_combos_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Itens do combo
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_procedimento_combo_itens" (
  "id"              SERIAL PRIMARY KEY,
  "combo_id"        INTEGER NOT NULL,
  "procedimento_id" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimento_combo_itens_combo_id_procedimento_id_key"
  ON "schs2vet"."tb_procedimento_combo_itens" ("combo_id", "procedimento_id");
CREATE INDEX IF NOT EXISTS "tb_procedimento_combo_itens_combo_id_idx"
  ON "schs2vet"."tb_procedimento_combo_itens" ("combo_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_procedimento_combo_itens_combo_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_procedimento_combo_itens"
      ADD CONSTRAINT "tb_procedimento_combo_itens_combo_id_fkey"
      FOREIGN KEY ("combo_id") REFERENCES "schs2vet"."tb_procedimento_combos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_procedimento_combo_itens_procedimento_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_procedimento_combo_itens"
      ADD CONSTRAINT "tb_procedimento_combo_itens_procedimento_id_fkey"
      FOREIGN KEY ("procedimento_id") REFERENCES "schs2vet"."tb_procedimentos_vet"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
