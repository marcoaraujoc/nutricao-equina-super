-- Fase 2 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md §5):
--   1. cadastro do ASSINANTE em tb_empresas
--   2. tb_planos            — catálogo comercial global
--   3. tb_assinaturas_empresa — uma assinatura por empresa
--
-- ⚠️ ESCRITA À MÃO, DE PROPÓSITO. O `prisma migrate diff` contra o banco vivo devolveu
-- 326 linhas: além destas mudanças, vinham 19 DROP FOREIGN KEY, 21 ADD FOREIGN KEY, 15
-- RENAME INDEX e 7 DROP INDEX de DRIFT PRÉ-EXISTENTE entre o banco e o schema Prisma
-- (consequência das migrations escritas à mão ao longo do projeto). Aplicar aquilo
-- reestruturaria o banco inteiro a pretexto de criar duas tabelas.
-- O drift é problema real e tem tarefa própria — não entra de carona aqui.
--
-- Tudo abaixo é ADITIVO: nenhuma coluna existente é alterada, nenhum dado é tocado.

-- ── 1. Cadastro do assinante ────────────────────────────────────────────────
-- `nome`, `cnpj`, `telefone` e `endereco` permanecem: o unique(ownerId, nome, cnpj) e
-- dezenas de pontos do código dependem deles. A limpeza é tarefa posterior.
ALTER TABLE "schs2vet"."tb_empresas"
  ADD COLUMN "razao_social"       VARCHAR(255),
  ADD COLUMN "nome_fantasia"      VARCHAR(255),
  ADD COLUMN "documento"          VARCHAR(14),
  ADD COLUMN "tipo_documento"     VARCHAR(4),
  ADD COLUMN "inscricao_estadual" VARCHAR(20),
  ADD COLUMN "email_contato"      VARCHAR(255),
  ADD COLUMN "whatsapp"           VARCHAR(15),
  ADD COLUMN "cep"                VARCHAR(10),
  ADD COLUMN "numero"             VARCHAR(20),
  ADD COLUMN "complemento"        VARCHAR(100),
  ADD COLUMN "bairro"             VARCHAR(100),
  ADD COLUMN "cidade"             VARCHAR(100),
  ADD COLUMN "estado"             VARCHAR(2),
  -- D3: SUSPENSA bloqueia o login de todos DESTA empresa. Default ATIVA para as 12
  -- empresas existentes continuarem funcionando.
  ADD COLUMN "status"             VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
  ADD COLUMN "cancelado_em"       TIMESTAMP(3);

-- ── 2. Catálogo de planos (control plane, global) ───────────────────────────
CREATE TABLE "schs2vet"."tb_planos" (
    "id"              SERIAL           NOT NULL,
    "slug"            VARCHAR(40)      NOT NULL,
    "nome"            VARCHAR(100)     NOT NULL,
    -- NULL = ILIMITADO (não é zero: zero é um plano sem nenhum assento)
    "limite_usuarios" INTEGER,
    "limite_animais"  INTEGER,
    "preco_mensal"    DOUBLE PRECISION,
    "ativo"           BOOLEAN          NOT NULL DEFAULT true,
    "ordem"           INTEGER          NOT NULL DEFAULT 0,
    "created_at"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_planos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_planos_slug_key" ON "schs2vet"."tb_planos"("slug");

-- ── 3. Assinatura da empresa ────────────────────────────────────────────────
CREATE TABLE "schs2vet"."tb_assinaturas_empresa" (
    "id"                       SERIAL       NOT NULL,
    "empresa_id"               INTEGER      NOT NULL,
    "plano_id"                 INTEGER      NOT NULL,
    -- Situação COMERCIAL. Quem bloqueia acesso é tb_empresas.status (D3).
    "status"                   VARCHAR(20)  NOT NULL DEFAULT 'TRIAL',
    "inicio_em"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim_em"                   TIMESTAMP(3),
    -- Negociação pontual: quando preenchido, VENCE o limite do plano
    "limite_usuarios_override" INTEGER,
    "observacao"               TEXT,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_assinaturas_empresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_assinaturas_empresa_empresa_id_key" ON "schs2vet"."tb_assinaturas_empresa"("empresa_id");
CREATE INDEX "tb_assinaturas_empresa_plano_id_idx"          ON "schs2vet"."tb_assinaturas_empresa"("plano_id");
CREATE INDEX "tb_assinaturas_empresa_status_idx"            ON "schs2vet"."tb_assinaturas_empresa"("status");

-- Empresa apagada leva a assinatura junto (CASCADE).
ALTER TABLE "schs2vet"."tb_assinaturas_empresa"
  ADD CONSTRAINT "tb_assinaturas_empresa_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: plano com assinatura viva não pode ser apagado — apagar deixaria empresa sem
-- limite definido, que é o mesmo que "ilimitado" e o oposto da intenção.
ALTER TABLE "schs2vet"."tb_assinaturas_empresa"
  ADD CONSTRAINT "tb_assinaturas_empresa_plano_id_fkey"
  FOREIGN KEY ("plano_id") REFERENCES "schs2vet"."tb_planos"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
