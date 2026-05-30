-- Migration: add_medicamento_estoque_prescricao_grupo
-- Separa catálogo global (tb_medicamentos) de estoque por clínica (tb_estoque_clinica).
-- Migra dados existentes de tb_produtos → tb_medicamentos + tb_estoque_clinica.
-- Cria tb_prescricao_grupos e adiciona grupoId + medicamentoCatId em tb_prescricoes.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. CATÁLOGO DE MEDICAMENTOS (substitui tb_produtos como catálogo global)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "schs2vet"."tb_medicamentos" (
    "id"                SERIAL        NOT NULL,
    "nome"              VARCHAR(255)  NOT NULL,
    "formaFarmaceutica" VARCHAR(100)  NOT NULL,
    "unidade"           VARCHAR(50)   NOT NULL,
    "apresentacao"      VARCHAR(100)  NOT NULL,
    "controlado"        BOOLEAN       NOT NULL DEFAULT false,
    "ativo"             BOOLEAN       NOT NULL DEFAULT true,
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_medicamentos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_medicamentos_nome_forma_apresentacao_key"
    ON "schs2vet"."tb_medicamentos"("nome", "formaFarmaceutica", "apresentacao");
CREATE INDEX "tb_medicamentos_ativo_idx"     ON "schs2vet"."tb_medicamentos"("ativo");
CREATE INDEX "tb_medicamentos_controlado_idx" ON "schs2vet"."tb_medicamentos"("controlado");

-- Migrar dados de tb_produtos → tb_medicamentos
INSERT INTO "schs2vet"."tb_medicamentos"
    ("id","nome","formaFarmaceutica","unidade","apresentacao","controlado","ativo","createdAt","updatedAt")
SELECT "id","nome","formaFarmaceutica","unidade","apresentacao","controlado","ativo","createdAt","updatedAt"
FROM "schs2vet"."tb_produtos";

-- Sincronizar sequência após INSERT com IDs explícitos
SELECT setval(pg_get_serial_sequence('"schs2vet"."tb_medicamentos"', 'id'),
              COALESCE((SELECT MAX("id") FROM "schs2vet"."tb_medicamentos"), 0) + 1, false);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. VIAS DE ADMINISTRAÇÃO DO CATÁLOGO
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "schs2vet"."tb_medicamento_vias" (
    "id"            SERIAL       NOT NULL,
    "medicamentoId" INTEGER      NOT NULL,
    "via"           VARCHAR(100) NOT NULL,
    CONSTRAINT "tb_medicamento_vias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_medicamento_vias_med_via_key" ON "schs2vet"."tb_medicamento_vias"("medicamentoId","via");
CREATE INDEX "tb_medicamento_vias_medicamentoId_idx" ON "schs2vet"."tb_medicamento_vias"("medicamentoId");

ALTER TABLE "schs2vet"."tb_medicamento_vias"
    ADD CONSTRAINT "tb_medicamento_vias_medicamentoId_fkey"
    FOREIGN KEY ("medicamentoId") REFERENCES "schs2vet"."tb_medicamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrar vias de tb_produto_vias_administracao → tb_medicamento_vias
INSERT INTO "schs2vet"."tb_medicamento_vias" ("id","medicamentoId","via")
SELECT "id","produtoId","via"
FROM "schs2vet"."tb_produto_vias_administracao";

SELECT setval(pg_get_serial_sequence('"schs2vet"."tb_medicamento_vias"', 'id'),
              COALESCE((SELECT MAX("id") FROM "schs2vet"."tb_medicamento_vias"), 0) + 1, false);

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ESTOQUE POR CLÍNICA
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "schs2vet"."tb_estoque_clinica" (
    "id"               SERIAL       NOT NULL,
    "medicamentoId"    INTEGER      NOT NULL,
    "empresaId"        INTEGER,
    "valor"            DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lote"             VARCHAR(100),
    "validade"         TIMESTAMP(3),
    "qtdEstoque"       INTEGER      NOT NULL DEFAULT 0,
    "estoqueMinimo"    INTEGER      NOT NULL DEFAULT 0,
    "estoqueAlarmante" INTEGER      NOT NULL DEFAULT 0,
    "ativo"            BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_estoque_clinica_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_estoque_clinica_medicamentoId_idx" ON "schs2vet"."tb_estoque_clinica"("medicamentoId");
CREATE INDEX "tb_estoque_clinica_empresaId_idx"     ON "schs2vet"."tb_estoque_clinica"("empresaId");
CREATE INDEX "tb_estoque_clinica_ativo_idx"         ON "schs2vet"."tb_estoque_clinica"("ativo");

ALTER TABLE "schs2vet"."tb_estoque_clinica"
    ADD CONSTRAINT "tb_estoque_clinica_medicamentoId_fkey"
    FOREIGN KEY ("medicamentoId") REFERENCES "schs2vet"."tb_medicamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_estoque_clinica"
    ADD CONSTRAINT "tb_estoque_clinica_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Criar entradas de estoque a partir dos produtos existentes (sem empresaId = global)
INSERT INTO "schs2vet"."tb_estoque_clinica"
    ("medicamentoId","empresaId","qtdEstoque","estoqueMinimo","ativo","createdAt","updatedAt")
SELECT "id", NULL, "estoqueAtual", "estoqueMinimo", "ativo", "createdAt", "updatedAt"
FROM "schs2vet"."tb_produtos";

SELECT setval(pg_get_serial_sequence('"schs2vet"."tb_estoque_clinica"', 'id'),
              COALESCE((SELECT MAX("id") FROM "schs2vet"."tb_estoque_clinica"), 0) + 1, false);

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. MOVIMENTOS DE ESTOQUE — troca FK produtoId → estoqueId
-- ──────────────────────────────────────────────────────────────────────────────

-- Remover FK antiga
ALTER TABLE "schs2vet"."tb_movimentos_estoque"
    DROP CONSTRAINT IF EXISTS "tb_movimentos_estoque_produtoId_fkey";

-- Adicionar nova coluna estoqueId com DEFAULT temporário = 0
ALTER TABLE "schs2vet"."tb_movimentos_estoque"
    ADD COLUMN "estoqueId" INTEGER NOT NULL DEFAULT 0;

-- Preencher estoqueId: mapeia produtoId → estoqueClinica.id (onde medicamentoId = produtoId e empresaId IS NULL)
UPDATE "schs2vet"."tb_movimentos_estoque" m
SET "estoqueId" = ec.id
FROM "schs2vet"."tb_estoque_clinica" ec
WHERE ec."medicamentoId" = m."produtoId"
  AND ec."empresaId" IS NULL;

-- Remover DEFAULT temporário e coluna antiga
ALTER TABLE "schs2vet"."tb_movimentos_estoque" ALTER COLUMN "estoqueId" DROP DEFAULT;
ALTER TABLE "schs2vet"."tb_movimentos_estoque" DROP COLUMN "produtoId";

-- Recriar índices
DROP INDEX IF EXISTS "schs2vet"."tb_movimentos_estoque_produtoId_idx";
CREATE INDEX "tb_movimentos_estoque_estoqueId_idx" ON "schs2vet"."tb_movimentos_estoque"("estoqueId");

-- Adicionar nova FK
ALTER TABLE "schs2vet"."tb_movimentos_estoque"
    ADD CONSTRAINT "tb_movimentos_estoque_estoqueId_fkey"
    FOREIGN KEY ("estoqueId") REFERENCES "schs2vet"."tb_estoque_clinica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. REMOVER TABELAS ANTIGAS DE PRODUTOS
-- ──────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS "schs2vet"."tb_produto_vias_administracao";
DROP TABLE IF EXISTS "schs2vet"."tb_produtos";

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. GRUPOS DE PRESCRIÇÃO
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "schs2vet"."tb_prescricao_grupos" (
    "id"            SERIAL       NOT NULL,
    "numero"        INTEGER      NOT NULL,
    "animalId"      INTEGER      NOT NULL,
    "veterinarioId" INTEGER      NOT NULL,
    "empresaId"     INTEGER,
    "status"        VARCHAR(20)  NOT NULL DEFAULT 'SALVO',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_prescricao_grupos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_prescricao_grupos_animalId_numero_key"
    ON "schs2vet"."tb_prescricao_grupos"("animalId","numero");
CREATE INDEX "tb_prescricao_grupos_animalId_idx"      ON "schs2vet"."tb_prescricao_grupos"("animalId");
CREATE INDEX "tb_prescricao_grupos_veterinarioId_idx"  ON "schs2vet"."tb_prescricao_grupos"("veterinarioId");

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
    ADD CONSTRAINT "tb_prescricao_grupos_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
    ADD CONSTRAINT "tb_prescricao_grupos_veterinarioId_fkey"
    FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. ADICIONAR COLUNAS EM tb_prescricoes
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "schs2vet"."tb_prescricoes"
    ADD COLUMN "grupoId"          INTEGER,
    ADD COLUMN "medicamentoCatId" INTEGER;

CREATE INDEX "tb_prescricoes_grupoId_idx"          ON "schs2vet"."tb_prescricoes"("grupoId");
CREATE INDEX "tb_prescricoes_animalId_idx"          ON "schs2vet"."tb_prescricoes"("animalId");
CREATE INDEX "tb_prescricoes_veterinarioId_idx"     ON "schs2vet"."tb_prescricoes"("veterinarioId");
CREATE INDEX "tb_prescricoes_medicamentoCatId_idx"  ON "schs2vet"."tb_prescricoes"("medicamentoCatId");

ALTER TABLE "schs2vet"."tb_prescricoes"
    ADD CONSTRAINT "tb_prescricoes_grupoId_fkey"
    FOREIGN KEY ("grupoId") REFERENCES "schs2vet"."tb_prescricao_grupos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_prescricoes"
    ADD CONSTRAINT "tb_prescricoes_medicamentoCatId_fkey"
    FOREIGN KEY ("medicamentoCatId") REFERENCES "schs2vet"."tb_medicamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;