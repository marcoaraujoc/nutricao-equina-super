-- Prestadores de serviço — catálogo PRÓPRIO e INDEPENDENTE de Fornecedor (não é
-- cópia de dados: é outra tabela). Mesma forma de cadastro (nome, documento,
-- contato, tipo de serviço, endereço) e o mesmo tratamento SYSTEM×CLIENTE de
-- tb_fornecedores, mas sem nenhuma linha compartilhada com ele — ver schema.prisma.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_prestadores" (
    "id"           SERIAL       NOT NULL,
    "nome"         VARCHAR(255) NOT NULL,
    "cpf"          VARCHAR(20),
    "cnpj"         VARCHAR(20),
    "telefone"     VARCHAR(30),
    "email"        VARCHAR(255),
    "tipo_servico" VARCHAR(50)  NOT NULL,
    "tipo_entrada" VARCHAR(10)  NOT NULL DEFAULT 'CLIENTE',
    "cep"          VARCHAR(10),
    "endereco"     VARCHAR(500),
    "complemento"  VARCHAR(255),
    "bairro"       VARCHAR(255),
    "cidade"       VARCHAR(255),
    "estado"       VARCHAR(2),
    "ativo"        BOOLEAN      NOT NULL DEFAULT true,
    "empresa_id"   INTEGER,
    "equipe_id"    INTEGER,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_prestadores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_prestadores_empresa_id_idx" ON "schs2vet"."tb_prestadores"("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_prestadores_equipe_id_idx"  ON "schs2vet"."tb_prestadores"("equipe_id");

-- tb_prestadores — TENANT DIRETO, mesmo padrão de tb_fornecedores
-- (20260806180000_fase7_rls_geral): SYSTEM/legado com empresa_id NULL escapa via
-- app_empresa_id() IS NULL (sem tenant no contexto — bootstrap/ADMIN global); linha
-- CLIENTE só é visível/gravável dentro da empresa ativa.
ALTER TABLE "schs2vet"."tb_prestadores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prestadores" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prestadores" ON "schs2vet"."tb_prestadores";
CREATE POLICY "tenant_tb_prestadores" ON "schs2vet"."tb_prestadores"
  USING ("schs2vet"."app_empresa_id"() IS NULL OR "empresa_id" = "schs2vet"."app_empresa_id"())
  WITH CHECK ("schs2vet"."app_empresa_id"() IS NULL OR "empresa_id" = "schs2vet"."app_empresa_id"());
