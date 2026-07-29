-- METERING DE IA POR CLIENTE (empresa)
--
-- Modelo: conta única no Google + medição interna. O que faltava não era capturar
-- o usage_metadata (isso já era feito) — era ATRIBUIR o consumo ao cliente que paga.
-- Num SaaS multi-tenant o "cliente" é a EMPRESA, não o usuário.

-- Sem FK, pelo mesmo motivo de AuditLog.empresaId: o log de consumo precisa
-- sobreviver à exclusão da empresa (é base de faturamento/auditoria).
ALTER TABLE "schs2vet"."tb_ai_usage_logs"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_ai_usage_logs_empresa_id_idx"
  ON "schs2vet"."tb_ai_usage_logs" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_ai_usage_logs_empresa_createdAt_idx"
  ON "schs2vet"."tb_ai_usage_logs" ("empresa_id", "createdAt");

-- Plano de consumo por empresa. AUSÊNCIA DE LINHA = sem limite (só medição) —
-- é o default seguro: ligar o metering não pode derrubar cliente nenhum.
-- Limite NULL = ilimitado naquela dimensão.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_ia_plano_empresa" (
  "id"                  SERIAL PRIMARY KEY,
  "empresa_id"          INTEGER NOT NULL,
  "plano"               VARCHAR(40) NOT NULL DEFAULT 'PADRAO',
  "limite_tokens_mes"   INTEGER,
  "limite_chamadas_mes" INTEGER,
  -- false = deixa passar e apenas sinaliza no painel (modo observação)
  "bloquear_ao_exceder" BOOLEAN NOT NULL DEFAULT true,
  "ativo"               BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_ia_plano_empresa_empresa_id_key"
  ON "schs2vet"."tb_ia_plano_empresa" ("empresa_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_ia_plano_empresa_empresa_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_ia_plano_empresa"
      ADD CONSTRAINT "tb_ia_plano_empresa_empresa_id_fkey"
      FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
