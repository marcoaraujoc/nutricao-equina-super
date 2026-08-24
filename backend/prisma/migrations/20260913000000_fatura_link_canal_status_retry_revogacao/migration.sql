-- ════════════════════════════════════════════════════════════════════════════
-- Endurecimento do link público de fatura: canal/destino do envio, status +
-- retry (reenvio automático via cron quando WhatsApp/e-mail falha na hora),
-- revogação (distinta de expiração) e contador de acesso público.
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (o usuário padrão do app não tem CREATE/ALTER no schema — CLAUDE.md §11).
--    Depois de aplicada, rodar `npx prisma generate`.
--
-- Nenhuma mudança de RLS: "tb_fatura_links_publicos" já é TENANT DIRETO desde
-- a migration 20260910000000, com a policy cobrindo a linha inteira —
-- colunas novas não precisam de policy própria.
--
-- ⚠️ `tentativas` é RECRIADA aqui, não reaproveitada: a coluna original (da
-- 20260910000000) contava tentativas de ACERTAR O CÓDIGO de acesso e foi
-- DROPADA pela 20260912000000 junto com o resto daquela camada (revertida).
-- Esta é uma coluna nova, semântica diferente — tentativas de REENVIO da
-- mensagem (WhatsApp/e-mail), consumida pelo cron de retry.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD COLUMN "canal"                VARCHAR(10),
  ADD COLUMN "destino"              VARCHAR(180),
  ADD COLUMN "status"               VARCHAR(20)  NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "tentativas"           INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN "ultimo_erro"          VARCHAR(300),
  ADD COLUMN "enviado_em"           TIMESTAMP(3),
  ADD COLUMN "proxima_tentativa_em" TIMESTAMP(3),
  ADD COLUMN "revogado_em"          TIMESTAMP(3),
  ADD COLUMN "revogado_por_id"      INTEGER,
  ADD COLUMN "ultimo_acesso_em"     TIMESTAMP(3),
  ADD COLUMN "qtd_acessos"          INTEGER      NOT NULL DEFAULT 0;

CREATE INDEX "tb_fatura_links_publicos_status_proxima_tentativa_em_idx"
  ON "schs2vet"."tb_fatura_links_publicos"("status", "proxima_tentativa_em");

ALTER TABLE "schs2vet"."tb_fatura_links_publicos"
  ADD CONSTRAINT "tb_fatura_links_publicos_revogado_por_id_fkey"
  FOREIGN KEY ("revogado_por_id") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
