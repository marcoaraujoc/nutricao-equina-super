-- Configuração global de SEGURANÇA (linha única, gerenciada pelo ADMIN da plataforma).
-- Mesmo padrão de CronAlertaConfig: uma linha só, lida ao vivo.
--
-- Tira o 2FA da dependência exclusiva de variável de ambiente: o ADMIN liga e
-- desliga pela tela de Configurações, sem deploy.
--
-- Ordem de resolução (ver services/mfaService.js):
--   1. MFA_EMAIL_ENABLED=false no .env  → OFF (kill-switch de emergência, sempre vence)
--   2. mfa_email_ativo desta tabela     → chave mestra do ADMIN
--   3. users.mfa_ativo                  → exceção por usuário
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_configuracao_seguranca" (
  "id"                 INTEGER PRIMARY KEY DEFAULT 1,
  -- Entregue DESLIGADO: ligar o 2FA para toda a base é decisão do ADMIN.
  "mfa_email_ativo"    BOOLEAN NOT NULL DEFAULT false,
  "atualizado_por_id"  INTEGER,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Trava de linha única: qualquer INSERT com outro id é rejeitado pelo banco.
  CONSTRAINT "tb_configuracao_seguranca_linha_unica" CHECK ("id" = 1)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_configuracao_seguranca_atualizado_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_configuracao_seguranca"
      ADD CONSTRAINT "tb_configuracao_seguranca_atualizado_por_id_fkey"
      FOREIGN KEY ("atualizado_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Linha única semeada já com o 2FA DESLIGADO.
INSERT INTO "schs2vet"."tb_configuracao_seguranca" ("id", "mfa_email_ativo")
VALUES (1, false)
ON CONFLICT ("id") DO NOTHING;
