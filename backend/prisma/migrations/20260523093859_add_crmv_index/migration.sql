-- CreateTable
CREATE TABLE "schs2vet"."tb_crmv_validos" (
    "id" SERIAL NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "uf" VARCHAR(2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_crmv_validos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schs2vet"."tb_crmv_sync_log" (
    "id" SERIAL NOT NULL,
    "executadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRegistros" INTEGER NOT NULL DEFAULT 0,
    "duracao" INTEGER,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "erro" TEXT,

    CONSTRAINT "tb_crmv_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_crmv_validos_hash_key" ON "schs2vet"."tb_crmv_validos"("hash");

-- CreateIndex
CREATE INDEX "tb_crmv_validos_uf_idx" ON "schs2vet"."tb_crmv_validos"("uf");
