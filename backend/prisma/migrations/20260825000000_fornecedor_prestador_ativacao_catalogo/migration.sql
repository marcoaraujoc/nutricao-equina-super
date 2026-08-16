-- Trilha de ATIVAÇÃO/INATIVAÇÃO para Fornecedor e Prestador — mesma lógica já
-- aplicada a `users` (migration 20260824000000_user_ativacao_trilha), agora
-- replicada aqui. Sem FK CASCADE: excluir quem fez a ação não pode apagar nem
-- destravar o registro afetado — SET NULL preserva a data, só perde o nome de
-- quem fez.

ALTER TABLE "schs2vet"."tb_fornecedores"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

ALTER TABLE "schs2vet"."tb_prestadores"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_fornecedores_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_fornecedores"
      ADD CONSTRAINT "tb_fornecedores_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_fornecedores_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_fornecedores"
      ADD CONSTRAINT "tb_fornecedores_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_prestadores_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_prestadores"
      ADD CONSTRAINT "tb_prestadores_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_prestadores_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_prestadores"
      ADD CONSTRAINT "tb_prestadores_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_fornecedores_ativo_por_id_idx"   ON "schs2vet"."tb_fornecedores"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_fornecedores_inativo_por_id_idx" ON "schs2vet"."tb_fornecedores"("inativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_prestadores_ativo_por_id_idx"    ON "schs2vet"."tb_prestadores"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_prestadores_inativo_por_id_idx"  ON "schs2vet"."tb_prestadores"("inativo_por_id");

-- Catálogo de "tipo de fornecedor" / "tipo de serviço do prestador" — cresce por
-- uso: tipo novo digitado no cadastro é gravado aqui e passa a ser oferecido nas
-- próximas vezes. TENANT DIRETO, mesma policy de tb_fornecedores/tb_prestadores
-- (sem escape para NULL): cada empresa só vê/cria os PRÓPRIOS tipos.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_catalogo_tipo_servico" (
    "id"             SERIAL       NOT NULL,
    "categoria"      VARCHAR(20)  NOT NULL,
    "nome"           VARCHAR(100) NOT NULL,
    "empresa_id"     INTEGER,
    "criado_por_id"  INTEGER,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_catalogo_tipo_servico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_catalogo_tipo_servico_categoria_empresa_idx"
  ON "schs2vet"."tb_catalogo_tipo_servico"("categoria", "empresa_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_catalogo_tipo_servico_criado_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_catalogo_tipo_servico"
      ADD CONSTRAINT "tb_catalogo_tipo_servico_criado_por_id_fkey"
      FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "schs2vet"."tb_catalogo_tipo_servico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_catalogo_tipo_servico" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_catalogo_tipo_servico" ON "schs2vet"."tb_catalogo_tipo_servico";
CREATE POLICY "tenant_tb_catalogo_tipo_servico" ON "schs2vet"."tb_catalogo_tipo_servico"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
