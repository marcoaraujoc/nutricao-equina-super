-- ════════════════════════════════════════════════════════════════════════════
-- Link público de fatura (envio por WhatsApp/e-mail passa a mandar um LINK,
-- não o PDF anexado — ver lib/faturaLinkPublico.js e o pedido do usuário em
-- 2026-09-10).
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (o usuário padrão do app não tem CREATE/ALTER no schema — CLAUDE.md §11).
--    Depois de aplicada:
--      1. rodar `npx prisma generate`;
--      2. adicionar "tb_fatura_links_publicos" a TENANT_PLANE em
--         backend/src/__tests__/tenancyRls.test.js — o gate só reconhece
--         tabela que existe de verdade; listá-la ANTES reprovaria o teste
--         "cita tabela inexistente" (mesmo cuidado de tb_reservas_estoque_vacina
--         e tb_animal_proprietario_historico).
--
-- `tb_fatura_links_publicos` é TENANT DIRETO (`empresa_id` na própria linha —
-- cópia do tenant da fatura na hora em que o link nasce, não um join). A leitura
-- pública (rota SEM autenticação, sem req.empresaId) roda em ESCOPO DE
-- PLATAFORMA (`comEscopoPlataforma`, mesmo mecanismo do `registrarAcessoNegado`
-- de login/2FA) — é o que permite achar a linha pelo TOKEN sem ter tenant
-- nenhum no contexto. A policy abaixo seria fail-closed (nega tudo) para
-- qualquer leitura fora desse escopo, inclusive SQL cru sem `comTenant`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE "schs2vet"."tb_fatura_links_publicos" (
    "id"              SERIAL       NOT NULL,
    "fatura_id"       INTEGER      NOT NULL,
    "empresa_id"      INTEGER      NOT NULL,
    "proprietario_id" INTEGER      NOT NULL,
    "token"           VARCHAR(64)  NOT NULL,
    "midia_chave"     VARCHAR(64)  NOT NULL,
    "tentativas"      INTEGER      NOT NULL DEFAULT 0,
    "bloqueado"       BOOLEAN      NOT NULL DEFAULT false,
    "verificado_em"   TIMESTAMP(3),
    "expira_em"       TIMESTAMP(3) NOT NULL,
    "criado_por_id"   INTEGER,
    "criado_em"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_fatura_links_publicos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_fatura_links_publicos_token_key" ON "schs2vet"."tb_fatura_links_publicos"("token");
CREATE INDEX "tb_fatura_links_publicos_fatura_id_idx" ON "schs2vet"."tb_fatura_links_publicos"("fatura_id");
CREATE INDEX "tb_fatura_links_publicos_expira_em_idx" ON "schs2vet"."tb_fatura_links_publicos"("expira_em");

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD CONSTRAINT "tb_fatura_links_publicos_fatura_id_fkey"
  FOREIGN KEY ("fatura_id") REFERENCES "schs2vet"."tb_faturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD CONSTRAINT "tb_fatura_links_publicos_proprietario_id_fkey"
  FOREIGN KEY ("proprietario_id") REFERENCES "schs2vet"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD CONSTRAINT "tb_fatura_links_publicos_criado_por_id_fkey"
  FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- tb_fatura_links_publicos — TENANT DIRETO (mesmo padrão de gerarPoliciesRls.js,
-- fase 7c: ausência de contexto NEGA; só o escopo de plataforma ou o tenant
-- carimbado enxergam a linha).
ALTER TABLE "schs2vet"."tb_fatura_links_publicos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_fatura_links_publicos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_fatura_links_publicos" ON "schs2vet"."tb_fatura_links_publicos";
CREATE POLICY "tenant_tb_fatura_links_publicos" ON "schs2vet"."tb_fatura_links_publicos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
