-- ════════════════════════════════════════════════════════════════════════════
-- CENTRAL DE DOCUMENTOS — sai do localStorage e vira módulo de verdade (2026-08-26)
--
-- Até aqui o módulo era protótipo 100% de front: templates em `localStorage`
-- (`s2vet_docs_templates`), seeds fixos no bundle, variáveis resolvidas com valores
-- de EXEMPLO e emissão com `animalNome: 'Thor'` cravado no código. Nada disso
-- sobrevive a trocar de navegador, e nada disso é multi-tenant.
--
-- Três objetos:
--
-- 1. `tb_documento_templates` — CATÁLOGO MISTO (`empresa_id` NULÁVEL).
--    NULL = modelo GLOBAL do sistema: os 12 anexos da Resolução CFMV nº 1.321/2020
--    (atestados e termos de consentimento), que valem para qualquer clínica e são o
--    piso normativo do que um documento veterinário precisa conter. Preenchido = o
--    modelo daquela clínica.
--    ⚠️ A policy é a MESMA de `tb_medicamentos`: o USING lê global + próprio, o
--    WITH CHECK só deixa ESCREVER o próprio. É isso que implementa o
--    COPY-ON-WRITE — alterar um modelo global não altera o global, cria a cópia
--    da empresa. Sem a assimetria, uma clínica reescreveria o atestado sanitário
--    de todas as outras.
--
-- 2. `tb_documentos_emitidos` — TENANT DIRETO (`empresa_id NOT NULL`).
--    O documento emitido é SNAPSHOT: guarda os blocos com as variáveis já
--    resolvidas. Editar o template depois NÃO pode reescrever o papel que o cliente
--    já recebeu — é o que permite reimprimir daqui a dois anos exatamente o que foi
--    entregue. Mesma premissa da `FaturaItem.descricao` gravada.
--
-- 3. `tb_usuario_empresa.assinatura_url` — a imagem da assinatura do profissional,
--    POR EMPRESA, pela mesma razão de `foto_url` (§36-f): o cadastro é da clínica,
--    e trocar a assinatura numa não pode reescrever o cadastro da outra. O CRMV que
--    acompanha já mora aqui (coluna `crmv`).
--
-- Sem backfill: nenhuma linha existe, e os 12 modelos globais entram pelo seed
-- (`backend/src/seeds/003_documentos_cfmv.seed.js`), idempotente por `chave`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Templates ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_documento_templates" (
  "id"            SERIAL       PRIMARY KEY,
  -- NULL = modelo GLOBAL (catálogo CFMV). Ver a nota de CATÁLOGO MISTO acima.
  "empresa_id"    INTEGER,
  -- Identificador estável do modelo GLOBAL, para o seed ser idempotente e para a
  -- cópia da empresa saber de qual norma nasceu. NULL nos modelos criados do zero.
  "chave"         VARCHAR(60),
  "nome"          VARCHAR(160) NOT NULL,
  "descricao"     VARCHAR(400) NOT NULL DEFAULT '',
  "categoria"     VARCHAR(30)  NOT NULL DEFAULT 'personalizados',
  "especie"       VARCHAR(10)  NOT NULL DEFAULT 'AMBOS',
  "tags"          TEXT[]       NOT NULL DEFAULT '{}',
  -- Os blocos do editor, no formato de frontend/src/modules/documentos/types.ts.
  -- JSONB e não tabela-filha de propósito: o bloco nunca é consultado por campo, é
  -- lido e gravado inteiro; normalizá-lo daria 18 formatos de linha para nada.
  "blocos"        JSONB        NOT NULL DEFAULT '[]',
  "favorito"      BOOLEAN      NOT NULL DEFAULT false,
  "compartilhado" BOOLEAN      NOT NULL DEFAULT false,
  -- Soft delete: vai para a Lixeira. Modelo de documento clínico não se apaga.
  "excluido"      BOOLEAN      NOT NULL DEFAULT false,
  "status"        VARCHAR(12)  NOT NULL DEFAULT 'RASCUNHO',
  -- De qual template esta cópia nasceu (global ou de empresa). SET NULL: perder a
  -- origem não pode levar a cópia junto.
  "origem_id"     INTEGER,
  "autor_id"      INTEGER,
  "autor_nome"    VARCHAR(255),
  "usos"          INTEGER      NOT NULL DEFAULT 0,
  "versao"        INTEGER      NOT NULL DEFAULT 1,
  -- Histórico de versões (os blocos ANTERIORES), capado na aplicação em 30.
  "versoes"       JSONB        NOT NULL DEFAULT '[]',
  "criado_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- `chave` é única entre os GLOBAIS — índice PARCIAL, porque a cópia da empresa
-- PRESERVA a chave de origem e várias empresas terão a mesma.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_documento_templates_chave_global_key"
  ON "schs2vet"."tb_documento_templates" ("chave")
  WHERE "empresa_id" IS NULL AND "chave" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "tb_documento_templates_empresa_id_idx"
  ON "schs2vet"."tb_documento_templates" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_documento_templates_categoria_idx"
  ON "schs2vet"."tb_documento_templates" ("categoria");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documento_templates"
    ADD CONSTRAINT "tb_documento_templates_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documento_templates"
    ADD CONSTRAINT "tb_documento_templates_origem_id_fkey"
    FOREIGN KEY ("origem_id") REFERENCES "schs2vet"."tb_documento_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documento_templates"
    ADD CONSTRAINT "tb_documento_templates_autor_id_fkey"
    FOREIGN KEY ("autor_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ── 2. Documentos emitidos ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_documentos_emitidos" (
  "id"             SERIAL       PRIMARY KEY,
  "empresa_id"     INTEGER      NOT NULL,
  "animal_id"      INTEGER      NOT NULL,
  -- O template pode ser apagado (ou ser global e sair do catálogo) sem levar o
  -- documento junto: por isso SET NULL + o nome gravado ao lado.
  "template_id"    INTEGER,
  "template_nome"  VARCHAR(160) NOT NULL,
  -- Sequência POR EMPRESA (DOC-0001), resolvida na aplicação dentro da mesma
  -- transaction da emissão.
  "numero"         INTEGER,
  "titulo"         VARCHAR(200) NOT NULL DEFAULT '',
  -- SNAPSHOT com as variáveis JÁ RESOLVIDAS — ver a nota do topo.
  "blocos"         JSONB        NOT NULL DEFAULT '[]',
  -- As variáveis usadas na resolução, para auditar de onde saiu cada valor.
  "contexto"       JSONB        NOT NULL DEFAULT '{}',
  -- Atendimento de origem, quando emitido de dentro de uma evolução aberta.
  "evolucao_id"    INTEGER,
  "veterinario_id" INTEGER,
  -- Nome do animal e do cliente COMO ESTAVAM na emissão (o cadastro muda; o papel não).
  "animal_nome"    VARCHAR(255) NOT NULL DEFAULT '',
  "cliente_nome"   VARCHAR(255) NOT NULL DEFAULT '',
  "emitido_em"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ativo"          BOOLEAN      NOT NULL DEFAULT true,
  "cancelado_motivo" TEXT
);

CREATE INDEX IF NOT EXISTS "tb_documentos_emitidos_empresa_id_idx"
  ON "schs2vet"."tb_documentos_emitidos" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_documentos_emitidos_animal_id_idx"
  ON "schs2vet"."tb_documentos_emitidos" ("animal_id");
CREATE INDEX IF NOT EXISTS "tb_documentos_emitidos_evolucao_id_idx"
  ON "schs2vet"."tb_documentos_emitidos" ("evolucao_id");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documentos_emitidos"
    ADD CONSTRAINT "tb_documentos_emitidos_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documentos_emitidos"
    ADD CONSTRAINT "tb_documentos_emitidos_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documentos_emitidos"
    ADD CONSTRAINT "tb_documentos_emitidos_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "schs2vet"."tb_documento_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documentos_emitidos"
    ADD CONSTRAINT "tb_documentos_emitidos_evolucao_id_fkey"
    FOREIGN KEY ("evolucao_id") REFERENCES "schs2vet"."tb_evolucoes_clinicas"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_documentos_emitidos"
    ADD CONSTRAINT "tb_documentos_emitidos_veterinario_id_fkey"
    FOREIGN KEY ("veterinario_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ── 3. Assinatura do profissional, por empresa ──────────────────────────────

ALTER TABLE "schs2vet"."tb_usuario_empresa"
  ADD COLUMN IF NOT EXISTS "assinatura_url" TEXT;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- Fail-closed (fase 7c): sem `app_empresa_id()` carimbado, nada passa — exceto o
-- ADMIN da plataforma (`app_plataforma()`).

-- tb_documento_templates — CATÁLOGO MISTO (lê global + próprio, só escreve o próprio)
ALTER TABLE "schs2vet"."tb_documento_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_documento_templates" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_documento_templates" ON "schs2vet"."tb_documento_templates";
CREATE POLICY "tenant_tb_documento_templates" ON "schs2vet"."tb_documento_templates"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- tb_documentos_emitidos — TENANT DIRETO
ALTER TABLE "schs2vet"."tb_documentos_emitidos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_documentos_emitidos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_documentos_emitidos" ON "schs2vet"."tb_documentos_emitidos";
CREATE POLICY "tenant_tb_documentos_emitidos" ON "schs2vet"."tb_documentos_emitidos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
