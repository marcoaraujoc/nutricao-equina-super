-- Integração Evolution API: instância exclusiva de WhatsApp por clínica.
-- O escopo é o MESMO da EmpresaConfiguracao (empresa CNPJ ou equipe de empresa
-- pessoal). O telefone usado é o campo `whatsapp` já existente — sem campo novo.
ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "wa_instance"  TEXT,
  ADD COLUMN IF NOT EXISTS "wa_status"    VARCHAR(30) NOT NULL DEFAULT 'DESCONECTADO',
  ADD COLUMN IF NOT EXISTS "wa_status_em" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_empresa_configuracoes_wa_instance_key"
  ON "schs2vet"."tb_empresa_configuracoes" ("wa_instance");
