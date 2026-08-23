-- ════════════════════════════════════════════════════════════════════════════
-- Remove a camada de código de acesso do link público de fatura (existiu por
-- um instante — migration 20260911000000). Decisão do usuário em 2026-09-11:
-- sem segundo fator nenhum; a segurança do link passa a ser 100% o TOKEN, que
-- em compensação vira 64 caracteres aleatórios do alfabeto base64url
-- (`A-Za-z0-9-_`, 384 bits de entropia — ver lib/faturaLinkPublico.js). A
-- coluna `token` já era VARCHAR(64), então não precisa mudar de tamanho.
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (depois, `npx prisma generate`). Tabela sem nenhuma linha usada em
--    produção — sem backfill, sem risco de dado perdido.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_fatura_links_publicos" DROP COLUMN IF EXISTS "codigo_acesso_hash";
ALTER TABLE "schs2vet"."tb_fatura_links_publicos" DROP COLUMN IF EXISTS "tentativas";
ALTER TABLE "schs2vet"."tb_fatura_links_publicos" DROP COLUMN IF EXISTS "bloqueado";
ALTER TABLE "schs2vet"."tb_fatura_links_publicos" DROP COLUMN IF EXISTS "verificado_em";
