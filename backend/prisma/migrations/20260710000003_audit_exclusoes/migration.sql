-- Auditoria estruturada de exclusões/cancelamentos no AuditLog
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "categoria"  TEXT;
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "entidade"   TEXT;
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "entidadeId" INTEGER;
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "animalId"   INTEGER;
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "motivo"     TEXT;
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "detalhes"   TEXT;

CREATE INDEX IF NOT EXISTS "tb_audit_logs_categoria_idx" ON "schs2vet"."tb_audit_logs"("categoria");
CREATE INDEX IF NOT EXISTS "tb_audit_logs_timestamp_idx" ON "schs2vet"."tb_audit_logs"("timestamp");
