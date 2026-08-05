-- Arquivos binários passam a viver NO BANCO (bytea), não no filesystem.
-- Motivo: /uploads era servido por express.static, sem autenticação — o único gate
-- era o nome aleatório do arquivo. Ver o comentário do model em schema.prisma.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_midia_arquivos" (
    "id"            SERIAL       NOT NULL,
    "chave"         VARCHAR(64)  NOT NULL,
    "conteudo"      BYTEA        NOT NULL,
    "mime_type"     VARCHAR(150) NOT NULL,
    "nome_original" VARCHAR(255),
    "tamanho"       INTEGER      NOT NULL,
    "pasta"         VARCHAR(64)  NOT NULL,
    "empresa_id"    INTEGER,
    "animal_id"     INTEGER,
    "criado_por_id" INTEGER,
    "publico"       BOOLEAN      NOT NULL DEFAULT false,
    "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_midia_arquivos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_midia_arquivos_chave_key"
    ON "schs2vet"."tb_midia_arquivos"("chave");
CREATE INDEX IF NOT EXISTS "tb_midia_arquivos_empresa_id_idx"
    ON "schs2vet"."tb_midia_arquivos"("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_midia_arquivos_animal_id_idx"
    ON "schs2vet"."tb_midia_arquivos"("animal_id");
CREATE INDEX IF NOT EXISTS "tb_midia_arquivos_pasta_idx"
    ON "schs2vet"."tb_midia_arquivos"("pasta");

-- Sem FK para empresa/animal DE PROPÓSITO: o binário sobrevive à exclusão do
-- registro que o referencia (mesma decisão de AuditLog.empresaId), e a limpeza é
-- feita explicitamente por quem apaga o dono do arquivo.
