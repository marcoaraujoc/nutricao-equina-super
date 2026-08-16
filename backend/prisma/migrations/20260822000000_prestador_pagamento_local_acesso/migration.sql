-- Prestador ganha login OPCIONAL (sem MembroEquipe — ver CLAUDE.md, sessão do
-- plano "Prestador: pagamento/local/acesso"), forma de pagamento e locais de
-- trabalho. Login sem MembroEquipe não tem RBAC; quem precisar de tela de
-- verdade continua indo por Equipe > Incluir Membro (cargo Fornecedor).

ALTER TABLE "schs2vet"."tb_prestadores"
  ADD COLUMN "user_id"         INTEGER,
  ADD COLUMN "tipo_pagamento"  VARCHAR(20),
  ADD COLUMN "forma_pagamento" VARCHAR(20),
  ADD COLUMN "valor_pagamento" DOUBLE PRECISION,
  ADD COLUMN "acesso_sistema"  BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "tb_prestadores_user_id_key" ON "schs2vet"."tb_prestadores"("user_id");

ALTER TABLE "schs2vet"."tb_prestadores"
  ADD CONSTRAINT "tb_prestadores_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Locais de trabalho do Prestador — irmã de tb_membro_locais_trabalho, sem
-- especialidade/tempo de consulta (Prestador não entra na Agenda).
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_prestador_locais_trabalho" (
    "id"                   SERIAL       NOT NULL,
    "prestador_id"         INTEGER      NOT NULL,
    "localizacao_id"       INTEGER      NOT NULL,
    "dias_trabalho"        VARCHAR(20),
    "hora_inicio_trabalho" VARCHAR(5),
    "hora_fim_trabalho"    VARCHAR(5),
    "empresa_id"           INTEGER,
    "equipe_id"            INTEGER,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_prestador_locais_trabalho_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_prestador_locais_trabalho_prestador_id_idx"   ON "schs2vet"."tb_prestador_locais_trabalho"("prestador_id");
CREATE INDEX IF NOT EXISTS "tb_prestador_locais_trabalho_localizacao_id_idx" ON "schs2vet"."tb_prestador_locais_trabalho"("localizacao_id");

ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho"
  ADD CONSTRAINT "tb_prestador_locais_trabalho_prestador_id_fkey"
  FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."tb_prestadores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho"
  ADD CONSTRAINT "tb_prestador_locais_trabalho_localizacao_id_fkey"
  FOREIGN KEY ("localizacao_id") REFERENCES "schs2vet"."tb_localizacoes_animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tb_prestador_locais_trabalho — TENANT DIRETO, mesmo padrão de tb_prestadores
-- (empresa_id/equipe_id são denormalizados do Prestador pai só para esta policy).
ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prestador_locais_trabalho" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prestador_locais_trabalho" ON "schs2vet"."tb_prestador_locais_trabalho";
CREATE POLICY "tenant_tb_prestador_locais_trabalho" ON "schs2vet"."tb_prestador_locais_trabalho"
  USING ("schs2vet"."app_empresa_id"() IS NULL OR "empresa_id" = "schs2vet"."app_empresa_id"())
  WITH CHECK ("schs2vet"."app_empresa_id"() IS NULL OR "empresa_id" = "schs2vet"."app_empresa_id"());
