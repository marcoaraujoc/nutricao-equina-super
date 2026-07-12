-- IP de origem nos eventos de auditoria (login/logout, exclusões, cancelamentos).
-- Estende a rastreabilidade que já existia em AuditoriaPermissao para o AuditLog geral.
ALTER TABLE "schs2vet"."tb_audit_logs" ADD COLUMN IF NOT EXISTS "ip" TEXT;
