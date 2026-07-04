-- AlterTable: trava de execução por item — presença de valor = item já executado (imutável)
ALTER TABLE "schs2vet"."tb_prescricoes"
  ADD COLUMN "executadoEm" TIMESTAMP(3);
