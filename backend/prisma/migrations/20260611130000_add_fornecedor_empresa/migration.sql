-- Fornecedor escopado por empresa.
-- empresaId NULL = SYSTEM (ADMIN) ou registro legado — visível para todas as empresas.
-- Sem FK proposital (mesmo padrão de AuditLog.empresaId): fornecedores sobrevivem à exclusão da empresa.
ALTER TABLE "schs2vet"."tb_fornecedores" ADD COLUMN "empresa_id" INTEGER;

CREATE INDEX "tb_fornecedores_empresa_id_idx" ON "schs2vet"."tb_fornecedores"("empresa_id");
