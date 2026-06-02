-- Migration: add_perfil_equipe_matriz
-- Cria tabelas de perfis explícitos e suas matrizes de permissão.
-- Perfis existem independentemente de membros — permite configurar antes de associar pessoas.

CREATE TABLE "schs2vet"."tb_perfis_equipe" (
    "id"        SERIAL       NOT NULL,
    "equipeId"  INTEGER      NOT NULL,
    "slug"      VARCHAR(50)  NOT NULL,
    "label"     VARCHAR(100) NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_perfis_equipe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "schs2vet"."tb_matriz_perfis" (
    "id"         SERIAL       NOT NULL,
    "equipeId"   INTEGER      NOT NULL,
    "perfilSlug" VARCHAR(50)  NOT NULL,
    "moduloSlug" VARCHAR(100) NOT NULL,
    "nivel"      VARCHAR(20)  NOT NULL DEFAULT 'NENHUM',
    CONSTRAINT "tb_matriz_perfis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_perfis_equipe_equipeId_slug_key"
    ON "schs2vet"."tb_perfis_equipe"("equipeId", "slug");

CREATE INDEX "tb_perfis_equipe_equipeId_idx"
    ON "schs2vet"."tb_perfis_equipe"("equipeId");

CREATE UNIQUE INDEX "tb_matriz_perfis_equipeId_perfilSlug_moduloSlug_key"
    ON "schs2vet"."tb_matriz_perfis"("equipeId", "perfilSlug", "moduloSlug");

CREATE INDEX "tb_matriz_perfis_equipeId_perfilSlug_idx"
    ON "schs2vet"."tb_matriz_perfis"("equipeId", "perfilSlug");

ALTER TABLE "schs2vet"."tb_perfis_equipe"
    ADD CONSTRAINT "tb_perfis_equipe_equipeId_fkey"
    FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_matriz_perfis"
    ADD CONSTRAINT "tb_matriz_perfis_equipeId_perfilSlug_fkey"
    FOREIGN KEY ("equipeId", "perfilSlug")
    REFERENCES "schs2vet"."tb_perfis_equipe"("equipeId", "slug")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_matriz_perfis"
    ADD CONSTRAINT "tb_matriz_perfis_moduloSlug_fkey"
    FOREIGN KEY ("moduloSlug") REFERENCES "schs2vet"."tb_modulos_sistema"("slug")
    ON DELETE RESTRICT ON UPDATE CASCADE;