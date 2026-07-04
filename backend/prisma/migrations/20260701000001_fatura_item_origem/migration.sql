-- AlterTable: rastreabilidade de FaturaItem até o registro de origem
ALTER TABLE "schs2vet"."tb_fatura_itens"
  ADD COLUMN "exameClinicoId" INTEGER,
  ADD COLUMN "prescricaoId" INTEGER,
  ADD COLUMN "vacinaClinicaId" INTEGER,
  ADD COLUMN "encaminhamentoClinicoId" INTEGER;

-- CreateIndex
CREATE INDEX "tb_fatura_itens_exameClinicoId_idx" ON "schs2vet"."tb_fatura_itens"("exameClinicoId");
CREATE INDEX "tb_fatura_itens_prescricaoId_idx" ON "schs2vet"."tb_fatura_itens"("prescricaoId");
CREATE INDEX "tb_fatura_itens_vacinaClinicaId_idx" ON "schs2vet"."tb_fatura_itens"("vacinaClinicaId");
CREATE INDEX "tb_fatura_itens_encaminhamentoClinicoId_idx" ON "schs2vet"."tb_fatura_itens"("encaminhamentoClinicoId");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_exameClinicoId_fkey" FOREIGN KEY ("exameClinicoId") REFERENCES "schs2vet"."tb_exames_clinicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_prescricaoId_fkey" FOREIGN KEY ("prescricaoId") REFERENCES "schs2vet"."tb_prescricoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_vacinaClinicaId_fkey" FOREIGN KEY ("vacinaClinicaId") REFERENCES "schs2vet"."tb_vacinas_clinicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_encaminhamentoClinicoId_fkey" FOREIGN KEY ("encaminhamentoClinicoId") REFERENCES "schs2vet"."tb_encaminhamentos_clinicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
