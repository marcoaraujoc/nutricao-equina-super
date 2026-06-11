-- Refatoração de tb_tratadores: tabela global compartilhada
-- Remove vínculo com empresa, adiciona vínculo com localizacao_animal

-- 1. Remover FK empresa_id (se existir)
ALTER TABLE schs2vet.tb_tratadores DROP CONSTRAINT IF EXISTS "tb_tratadores_empresaId_fkey";

-- 2. Remover colunas do modelo antigo
ALTER TABLE schs2vet.tb_tratadores DROP COLUMN IF EXISTS local_trabalho;
ALTER TABLE schs2vet.tb_tratadores DROP COLUMN IF EXISTS empresa_id;

-- 3. Adicionar novas colunas
ALTER TABLE schs2vet.tb_tratadores ADD COLUMN IF NOT EXISTS localizacao_id INTEGER;
ALTER TABLE schs2vet.tb_tratadores ADD COLUMN IF NOT EXISTS tipo_entrada VARCHAR(10) NOT NULL DEFAULT 'CLIENTE';

-- 4. FK localizacao_id → tb_localizacoes_animal (condicional para shadow DB)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'schs2vet' AND table_name = 'tb_localizacoes_animal'
  ) THEN
    ALTER TABLE schs2vet.tb_tratadores
      ADD CONSTRAINT fk_tratador_localizacao
      FOREIGN KEY (localizacao_id)
      REFERENCES schs2vet.tb_localizacoes_animal(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 5. Índice em localizacao_id
CREATE INDEX IF NOT EXISTS idx_tb_tratadores_localizacao_id ON schs2vet.tb_tratadores(localizacao_id);

-- 6. UNIQUE (nome, localizacao_id) — PostgreSQL trata NULL como distinto (ok para nosso caso)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'schs2vet'
      AND table_name   = 'tb_tratadores'
      AND constraint_name = 'unique_tratador_nome_local'
  ) THEN
    ALTER TABLE schs2vet.tb_tratadores
      ADD CONSTRAINT unique_tratador_nome_local UNIQUE (nome, localizacao_id);
  END IF;
END $$;

-- 7. Adicionar tratador_id em tb_animais
ALTER TABLE schs2vet.tb_animais ADD COLUMN IF NOT EXISTS tratador_id INTEGER;

-- 8. FK tratador_id → tb_tratadores (condicional)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'schs2vet' AND table_name = 'tb_tratadores'
  ) THEN
    ALTER TABLE schs2vet.tb_animais
      ADD CONSTRAINT fk_animal_tratador
      FOREIGN KEY (tratador_id)
      REFERENCES schs2vet.tb_tratadores(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 9. Índice em tratador_id
CREATE INDEX IF NOT EXISTS idx_tb_animais_tratador_id ON schs2vet.tb_animais(tratador_id);
