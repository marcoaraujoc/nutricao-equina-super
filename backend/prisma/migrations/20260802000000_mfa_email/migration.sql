-- 2FA POR E-MAIL (segundo fator no login com senha)
--
-- Ligado por padrão para todos os usuários. Desligar individualmente:
--   UPDATE schs2vet.users SET mfa_ativo = false WHERE id = <id>;
-- Kill-switch global de emergência (sem migration): MFA_EMAIL_ENABLED=false no .env.
ALTER TABLE "schs2vet"."users"
  ADD COLUMN IF NOT EXISTS "mfa_ativo" BOOLEAN NOT NULL DEFAULT true;

-- Desafio pendente entre a senha correta e a emissão dos cookies de sessão.
-- O código NUNCA é guardado em claro: só o hash SHA-256.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_mfa_desafios" (
  "id"          TEXT PRIMARY KEY,
  "user_id"     INTEGER NOT NULL,
  "codigo_hash" TEXT NOT NULL,
  "expira_em"   TIMESTAMP(3) NOT NULL,
  "tentativas"  INTEGER NOT NULL DEFAULT 0,
  "reenvios"    INTEGER NOT NULL DEFAULT 0,
  "consumido"   BOOLEAN NOT NULL DEFAULT false,
  "ip"          VARCHAR(64),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "tb_mfa_desafios_user_id_idx"
  ON "schs2vet"."tb_mfa_desafios" ("user_id");
-- Usado pela limpeza periódica dos desafios vencidos
CREATE INDEX IF NOT EXISTS "tb_mfa_desafios_expira_em_idx"
  ON "schs2vet"."tb_mfa_desafios" ("expira_em");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_mfa_desafios_user_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_mfa_desafios"
      ADD CONSTRAINT "tb_mfa_desafios_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
