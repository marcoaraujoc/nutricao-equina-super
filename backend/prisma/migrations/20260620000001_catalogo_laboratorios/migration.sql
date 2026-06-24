-- Migration: catálogo de laboratórios e exames para solicitação clínica

CREATE TABLE IF NOT EXISTS schs2vet.tb_laboratorios (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(255) NOT NULL,
  contato    VARCHAR(100),
  email      VARCHAR(255),
  site       VARCHAR(255),
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schs2vet.tb_exame_grupos (
  id              SERIAL PRIMARY KEY,
  laboratorio_id  INTEGER NOT NULL,
  nome            VARCHAR(255) NOT NULL,
  ordem           INTEGER NOT NULL DEFAULT 0,
  ativo           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS schs2vet.tb_exame_itens (
  id       SERIAL PRIMARY KEY,
  grupo_id INTEGER NOT NULL,
  nome     VARCHAR(500) NOT NULL,
  sigla    VARCHAR(100),
  ativo    BOOLEAN NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_laboratorios_nome_key"              ON schs2vet.tb_laboratorios   (nome);
CREATE INDEX        IF NOT EXISTS "tb_laboratorios_ativo_idx"             ON schs2vet.tb_laboratorios   (ativo);
CREATE UNIQUE INDEX IF NOT EXISTS "tb_exame_grupos_laboratorio_id_nome_key" ON schs2vet.tb_exame_grupos (laboratorio_id, nome);
CREATE INDEX        IF NOT EXISTS "tb_exame_grupos_laboratorio_id_idx"    ON schs2vet.tb_exame_grupos   (laboratorio_id);
CREATE UNIQUE INDEX IF NOT EXISTS "tb_exame_itens_grupo_id_nome_key"      ON schs2vet.tb_exame_itens    (grupo_id, nome);
CREATE INDEX        IF NOT EXISTS "tb_exame_itens_grupo_id_idx"           ON schs2vet.tb_exame_itens    (grupo_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_exame_grupos_laboratorio_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.tb_exame_grupos
      ADD CONSTRAINT "tb_exame_grupos_laboratorio_id_fkey"
      FOREIGN KEY (laboratorio_id) REFERENCES schs2vet.tb_laboratorios(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_exame_itens_grupo_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.tb_exame_itens
      ADD CONSTRAINT "tb_exame_itens_grupo_id_fkey"
      FOREIGN KEY (grupo_id) REFERENCES schs2vet.tb_exame_grupos(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
