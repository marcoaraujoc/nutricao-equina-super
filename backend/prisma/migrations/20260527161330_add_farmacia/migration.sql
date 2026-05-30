-- CreateTable
CREATE TABLE "schs2vet"."tb_produtos" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "formaFarmaceutica" VARCHAR(50) NOT NULL,
    "unidade" VARCHAR(30) NOT NULL,
    "apresentacao" VARCHAR(30) NOT NULL,
    "controlado" BOOLEAN NOT NULL DEFAULT false,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 0,
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_produto_vias_administracao" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "via" VARCHAR(50) NOT NULL,

    CONSTRAINT "tb_produto_vias_administracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_movimentos_estoque" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_movimentos_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tb_produtos_ativo_idx" ON "schs2vet"."tb_produtos"("ativo");

-- CreateIndex
CREATE INDEX "tb_produtos_controlado_idx" ON "schs2vet"."tb_produtos"("controlado");

-- CreateIndex
CREATE UNIQUE INDEX "tb_produtos_nome_formaFarmaceutica_apresentacao_key" ON "schs2vet"."tb_produtos"("nome", "formaFarmaceutica", "apresentacao");

-- CreateIndex
CREATE INDEX "tb_produto_vias_administracao_produtoId_idx" ON "schs2vet"."tb_produto_vias_administracao"("produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "tb_produto_vias_administracao_produtoId_via_key" ON "schs2vet"."tb_produto_vias_administracao"("produtoId", "via");

-- CreateIndex
CREATE INDEX "tb_movimentos_estoque_produtoId_idx" ON "schs2vet"."tb_movimentos_estoque"("produtoId");

-- CreateIndex
CREATE INDEX "tb_movimentos_estoque_createdAt_idx" ON "schs2vet"."tb_movimentos_estoque"("createdAt");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_produto_vias_administracao" ADD CONSTRAINT "tb_produto_vias_administracao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "schs2vet"."tb_produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_movimentos_estoque" ADD CONSTRAINT "tb_movimentos_estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "schs2vet"."tb_produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
