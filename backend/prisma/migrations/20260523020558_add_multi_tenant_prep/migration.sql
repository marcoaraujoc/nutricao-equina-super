-- AlterTable
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN     "empresaId" INTEGER;

-- AlterTable
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN     "empresaId" INTEGER;

-- CreateIndex
CREATE INDEX "tb_animais_empresaId_idx" ON "schs2vet"."tb_animais"("empresaId");

-- CreateIndex
CREATE INDEX "tb_audit_logs_empresaId_idx" ON "schs2vet"."tb_audit_logs"("empresaId");

-- AddForeignKey
ALTER TABLE "schs2vet"."tb_animais" ADD CONSTRAINT "tb_animais_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
