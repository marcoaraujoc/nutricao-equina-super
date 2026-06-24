-- Migration: catálogo de exames de diagnóstico por imagem

CREATE TABLE IF NOT EXISTS schs2vet.tb_imagem_exame_grupos (
  id         SERIAL PRIMARY KEY,
  nome       VARCHAR(255) NOT NULL UNIQUE,
  categoria  VARCHAR(255) NOT NULL DEFAULT 'Diagnóstico por Imagem',
  ordem      INTEGER NOT NULL DEFAULT 0,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_imagem_exame_grupos_ativo ON schs2vet.tb_imagem_exame_grupos(ativo);

CREATE TABLE IF NOT EXISTS schs2vet.tb_imagem_exame_itens (
  id        SERIAL PRIMARY KEY,
  grupo_id  INTEGER NOT NULL,
  codigo    VARCHAR(20) NOT NULL UNIQUE,
  nome      VARCHAR(500) NOT NULL,
  sigla     VARCHAR(100),
  especie   VARCHAR(50) NOT NULL DEFAULT 'Ambas',
  ativo     BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT fk_imagem_exame_itens_grupo
    FOREIGN KEY (grupo_id) REFERENCES schs2vet.tb_imagem_exame_grupos(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_imagem_exame_itens_grupo ON schs2vet.tb_imagem_exame_itens(grupo_id);
