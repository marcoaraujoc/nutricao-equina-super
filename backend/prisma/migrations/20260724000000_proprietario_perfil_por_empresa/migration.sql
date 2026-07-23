-- Perfil do proprietário por EMPRESA (isolamento multi-tenant do cadastro do cliente).
-- O User continua sendo a identidade de login (email único global); os dados cadastrais
-- que cada clínica mantém sobre o mesmo cliente passam a viver aqui, um registro por empresa.

CREATE TABLE "schs2vet"."tb_proprietario_perfis" (
    "id"                    SERIAL       NOT NULL,
    "user_id"               INTEGER      NOT NULL,
    "empresa_id"            INTEGER      NOT NULL,
    "full_name"             VARCHAR(255),
    "phone"                 VARCHAR(30),
    "phone2"                VARCHAR(30),
    "cpf"                   VARCHAR(14),
    "cnpj"                  VARCHAR(18),
    "cep"                   VARCHAR(10),
    "endereco"              VARCHAR(255),
    "complemento"           VARCHAR(100),
    "bairro"                VARCHAR(100),
    "cidade"                VARCHAR(100),
    "estado"                VARCHAR(2),
    "mensalista"            BOOLEAN      NOT NULL DEFAULT false,
    "valor_assistencia"     DOUBLE PRECISION,
    "frequencia_visitas"    INTEGER,
    "dia_vencimento_fatura" INTEGER,
    "ativo"                 BOOLEAN      NOT NULL DEFAULT true,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tb_proprietario_perfis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_proprietario_perfis_user_id_empresa_id_key"
    ON "schs2vet"."tb_proprietario_perfis"("user_id", "empresa_id");

CREATE INDEX "tb_proprietario_perfis_empresa_id_idx"
    ON "schs2vet"."tb_proprietario_perfis"("empresa_id");

ALTER TABLE "schs2vet"."tb_proprietario_perfis"
    ADD CONSTRAINT "tb_proprietario_perfis_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_proprietario_perfis"
    ADD CONSTRAINT "tb_proprietario_perfis_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ────────────────────────────────────────────────────────────────────
-- Cria um perfil por (proprietário, empresa) COPIANDO os dados atuais do User, para
-- que nenhuma clínica veja cadastro em branco depois da migração. As empresas de cada
-- proprietário vêm de duas origens (mesmo critério de whereProprietarioNoEscopo):
--   1. empresa dos animais ATIVOS do proprietário;
--   2. empresa que cadastrou o proprietário (tb_users.empresa_id).
INSERT INTO "schs2vet"."tb_proprietario_perfis" (
    "user_id", "empresa_id", "full_name", "phone", "phone2", "cpf", "cnpj",
    "cep", "endereco", "complemento", "bairro", "cidade", "estado",
    "mensalista", "valor_assistencia", "frequencia_visitas", "dia_vencimento_fatura",
    "ativo", "created_at", "updated_at"
)
SELECT DISTINCT ON (v."user_id", v."empresa_id")
    v."user_id", v."empresa_id",
    u."fullName", u."phone", u."phone2", u."cpf", u."cnpj",
    u."cep", u."endereco", u."complemento", u."bairro", u."cidade", u."estado",
    COALESCE(u."mensalista", false), u."valorAssistencia", u."frequenciaVisitas", u."dia_vencimento_fatura",
    true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT a."userId" AS "user_id", a."empresaId" AS "empresa_id"
      FROM "schs2vet"."tb_animais" a
     WHERE a."empresaId" IS NOT NULL AND a."ativo" = true
    UNION
    SELECT us."id" AS "user_id", us."empresa_id"
      FROM "schs2vet"."users" us
     WHERE us."empresa_id" IS NOT NULL AND us."userType" = 'PROPRIETARIO'
) v
JOIN "schs2vet"."users" u ON u."id" = v."user_id"
WHERE u."userType" = 'PROPRIETARIO'
ON CONFLICT ("user_id", "empresa_id") DO NOTHING;
