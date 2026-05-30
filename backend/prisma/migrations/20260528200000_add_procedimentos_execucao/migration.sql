-- Migration: add_procedimentos_execucao
-- 1. Tabela de Procedimentos Veterinários (catálogo global)
-- 2. Campos de execução em tb_prescricao_grupos (EXECUTADO status + auditoria)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CATÁLOGO DE PROCEDIMENTOS VETERINÁRIOS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "schs2vet"."tb_procedimentos_vet" (
    "id"               SERIAL        NOT NULL,
    "codigo"           VARCHAR(50),
    "nome"             VARCHAR(255)  NOT NULL,
    "nomeAbreviado"    VARCHAR(100),
    "descricao"        TEXT,
    "categoria"        VARCHAR(100)  NOT NULL,
    "subcategoria"     VARCHAR(100),
    "especialidade"    VARCHAR(100),
    "tipoProcedimento" VARCHAR(50),      -- CLINICO | CIRURGICO | DIAGNOSTICO
    "duracao"          INTEGER,          -- minutos
    "requerAnestesia"  BOOLEAN       NOT NULL DEFAULT false,
    "requerInternacao" BOOLEAN       NOT NULL DEFAULT false,
    "risco"            VARCHAR(20),      -- BAIXO | MEDIO | ALTO
    "valorCusto"       DOUBLE PRECISION,
    "valorVenda"       DOUBLE PRECISION,
    "ativo"            BOOLEAN       NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_procedimentos_vet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_procedimentos_vet_codigo_key"
    ON "schs2vet"."tb_procedimentos_vet"("codigo")
    WHERE "codigo" IS NOT NULL;

CREATE INDEX "tb_procedimentos_vet_ativo_idx"      ON "schs2vet"."tb_procedimentos_vet"("ativo");
CREATE INDEX "tb_procedimentos_vet_categoria_idx"   ON "schs2vet"."tb_procedimentos_vet"("categoria");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CAMPOS DE EXECUÇÃO EM tb_prescricao_grupos
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
    ADD COLUMN "finalizadoPorId" INTEGER,
    ADD COLUMN "finalizadoEm"    TIMESTAMP(3),
    ADD COLUMN "executadoPorId"  INTEGER,
    ADD COLUMN "executadoEm"     TIMESTAMP(3);

CREATE INDEX "tb_prescricao_grupos_executadoPorId_idx" ON "schs2vet"."tb_prescricao_grupos"("executadoPorId");
CREATE INDEX "tb_prescricao_grupos_status_idx"          ON "schs2vet"."tb_prescricao_grupos"("status");

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
    ADD CONSTRAINT "tb_prescricao_grupos_finalizadoPorId_fkey"
    FOREIGN KEY ("finalizadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
    ADD CONSTRAINT "tb_prescricao_grupos_executadoPorId_fkey"
    FOREIGN KEY ("executadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;