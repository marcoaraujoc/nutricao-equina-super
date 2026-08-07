-- ════════════════════════════════════════════════════════════════════════════
-- DROP das COLUNAS FANTASMA de tb_tratadores (2026-08-06)
--
-- A tabela tinha DUAS colunas para a mesma ideia, e as camelCase eram lixo:
--   • "empresaId"   (camelCase, nullable) — duplicata MORTA de "empresa_id" (NOT NULL,
--                    a real, usada pelo RLS e pelo app via `@map("empresa_id")`). 0/29.
--   • "localTrabalho" — substituída por "localizacao_id". 0/29.
-- O Prisma NÃO conhece nenhuma das duas (o schema mapeia para as colunas snake_case);
-- nenhum filtro as lê. São ambiguidade estrutural pura. Removidas.
--
-- Seguro: 0 linhas preenchidas nas duas, nenhum código as referencia. `IF EXISTS`
-- protege ambientes onde já não existam.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_tratadores" DROP COLUMN IF EXISTS "empresaId";
ALTER TABLE "schs2vet"."tb_tratadores" DROP COLUMN IF EXISTS "localTrabalho";
