-- CreateTable: LocalizacaoAnimal
-- Tabela global de localizações de animais, compartilhada entre todas as empresas.

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_localizacoes_animal" (
  "id"                SERIAL PRIMARY KEY,
  "nome"              VARCHAR(255)  NOT NULL,
  "cnpj"              VARCHAR(18),
  "cep"               VARCHAR(10),
  "endereco"          VARCHAR(500),
  "pessoaResponsavel" VARCHAR(255),
  "telefone"          VARCHAR(30),
  "tipoLocalizacao"   VARCHAR(50)   NOT NULL,
  "tipoEntrada"       VARCHAR(10)   NOT NULL DEFAULT 'CLIENTE',
  "ativo"             BOOLEAN       NOT NULL DEFAULT TRUE,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "schs2vet"."tb_localizacoes_animal"
  ADD CONSTRAINT "tb_localizacoes_animal_nome_key" UNIQUE ("nome");

CREATE INDEX IF NOT EXISTS "tb_localizacoes_animal_tipoLocalizacao_idx"
  ON "schs2vet"."tb_localizacoes_animal" ("tipoLocalizacao");

CREATE INDEX IF NOT EXISTS "tb_localizacoes_animal_ativo_idx"
  ON "schs2vet"."tb_localizacoes_animal" ("ativo");
