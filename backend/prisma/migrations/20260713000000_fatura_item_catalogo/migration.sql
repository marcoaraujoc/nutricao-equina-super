-- Catálogo de itens frequentes da fatura (reutilizáveis em novas faturas)
CREATE TABLE "schs2vet"."tb_fatura_item_catalogo" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_fatura_item_catalogo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_fatura_item_catalogo_empresa_id_idx" ON "schs2vet"."tb_fatura_item_catalogo"("empresa_id");
