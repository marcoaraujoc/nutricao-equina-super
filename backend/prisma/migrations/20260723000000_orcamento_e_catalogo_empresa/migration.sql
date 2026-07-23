-- Catálogo escopado por empresa (habilita item manual do orçamento).
-- null = catálogo global (ADMIN); setado = próprio da empresa (só ela vê/edita).
ALTER TABLE "schs2vet"."tb_medicamentos"     ADD COLUMN "empresa_id" INTEGER;
ALTER TABLE "schs2vet"."tb_procedimentos_vet" ADD COLUMN "empresa_id" INTEGER;
CREATE INDEX "tb_medicamentos_empresa_id_idx"     ON "schs2vet"."tb_medicamentos"("empresa_id");
CREATE INDEX "tb_procedimentos_vet_empresa_id_idx" ON "schs2vet"."tb_procedimentos_vet"("empresa_id");

-- Orçamento (etapa opcional) + itens
CREATE TABLE "schs2vet"."tb_orcamentos" (
    "id"              SERIAL NOT NULL,
    "empresa_id"      INTEGER NOT NULL,
    "equipe_id"       INTEGER,
    "proprietario_id" INTEGER NOT NULL,
    "criado_por_id"   INTEGER NOT NULL,
    "numero"          INTEGER NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'RASCUNHO',
    "observacao"      TEXT,
    "ativo"           BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tb_orcamentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tb_orcamentos_empresa_id_idx"      ON "schs2vet"."tb_orcamentos"("empresa_id");
CREATE INDEX "tb_orcamentos_proprietario_id_idx" ON "schs2vet"."tb_orcamentos"("proprietario_id");
CREATE INDEX "tb_orcamentos_status_idx"          ON "schs2vet"."tb_orcamentos"("status");

CREATE TABLE "schs2vet"."tb_orcamento_itens" (
    "id"             SERIAL NOT NULL,
    "orcamento_id"   INTEGER NOT NULL,
    "animal_id"      INTEGER,
    "tipo"           TEXT NOT NULL,
    "ref_id"         INTEGER,
    "especialidade"  VARCHAR(100),
    "descricao"      VARCHAR(255) NOT NULL,
    "quantidade"     DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unidade"        VARCHAR(50),
    "valor_unitario" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valor_total"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status_item"    TEXT NOT NULL DEFAULT 'PENDENTE',
    "importado_em"   TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tb_orcamento_itens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tb_orcamento_itens_orcamento_id_idx" ON "schs2vet"."tb_orcamento_itens"("orcamento_id");
CREATE INDEX "tb_orcamento_itens_animal_id_idx"    ON "schs2vet"."tb_orcamento_itens"("animal_id");

ALTER TABLE "schs2vet"."tb_orcamentos"
    ADD CONSTRAINT "tb_orcamentos_proprietario_id_fkey" FOREIGN KEY ("proprietario_id") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_orcamentos"
    ADD CONSTRAINT "tb_orcamentos_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_orcamento_itens"
    ADD CONSTRAINT "tb_orcamento_itens_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "schs2vet"."tb_orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_orcamento_itens"
    ADD CONSTRAINT "tb_orcamento_itens_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE SET NULL ON UPDATE CASCADE;
