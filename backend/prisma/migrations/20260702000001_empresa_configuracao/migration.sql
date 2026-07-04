-- CreateTable
CREATE TABLE "schs2vet"."tb_empresa_configuracoes" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "equipeId" INTEGER,
    "logoUrl" TEXT,
    "diaFechamentoFatura" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_empresa_configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tb_empresa_configuracoes_empresaId_equipeId_key" ON "schs2vet"."tb_empresa_configuracoes"("empresaId", "equipeId");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_empresa_configuracoes" ADD CONSTRAINT "tb_empresa_configuracoes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_empresa_configuracoes" ADD CONSTRAINT "tb_empresa_configuracoes_equipeId_fkey" FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
