-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7 — ÓRFÃ POR EMPRESA APAGADA: elimina as linhas e FECHA A PORTA
--
-- 🔴 O PROBLEMA (medido, não suposto)
-- 28 linhas em 5 tabelas apontavam para a empresa **37**, que não existe mais. Todas
-- para a MESMA empresa: ela foi apagada em algum momento e levou junto a integridade
-- de tudo que a referenciava — sem erro, sem aviso.
--
--   tb_ai_usage_logs 10 · tb_audit_logs 8 · tb_tratadores 4 · tb_faturas 3 · tb_fornecedores 3
--
-- Sob RLS elas são invisíveis para TODO tenant: não existe empresa com aquele id para
-- casar na policy. Não são recuperáveis — não há a quem devolvê-las.
--
-- ⚠️ POR QUE O `RESTRICT` DA FASE 5 NÃO IMPEDIU: ele trocou `SET NULL` por `RESTRICT`
-- nas 3 tabelas que TINHAM FK. Estas cinco **não tinham FK nenhuma** — nada a trocar.
-- A lição: `ON DELETE` só protege onde existe FK; a ausência de FK não aparece em
-- nenhuma listagem de `delete_rule`, então some da revisão.
--
-- ── A DECISÃO: FK EM TODAS, COM `RESTRICT` ─────────────────────────────────
-- Isto CONTRARIA uma decisão antiga registrada no CLAUDE.md §5 —
--   "AuditLog.empresaId (nullable, **sem FK** — logs sobrevivem à exclusão da empresa)"
-- e o mesmo para `tb_ai_usage_logs`.
--
-- A contradição é real e a decisão nova vence, porque a premissa da antiga caiu: ela
-- assumia que empresa É APAGADA. Desde a EXCLUSÃO LÓGICA (§2.5 do plano), empresa se
-- INATIVA (`tb_empresas.status`), nunca se apaga. Com isso, "o log sobrevive à exclusão"
-- deixou de proteger alguma coisa e passou a ser apenas o mecanismo que produziu estas
-- 28 órfãs — o log não sobreviveu à empresa, ele virou lixo inalcançável.
--
-- Com `RESTRICT` o banco passa a RECUSAR apagar empresa que tenha qualquer registro.
-- Órfã por empresa apagada fica **estruturalmente impossível**, não "improvável".
--
-- ── ORDEM ──────────────────────────────────────────────────────────────────
-- Apagar ANTES de criar a FK: com as 28 linhas presentes, o `ADD CONSTRAINT` falharia
-- (`violates foreign key constraint`) e a migration morreria no meio.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Remove as linhas que apontam para empresa inexistente ────────────────
-- (cópia preservada fora do repositório antes da execução)
DELETE FROM "schs2vet"."tb_fatura_itens"
 WHERE "faturaId" IN (
   SELECT f."id" FROM "schs2vet"."tb_faturas" f
   LEFT JOIN "schs2vet"."tb_empresas" e ON e."id" = f."empresa_id"
   WHERE f."empresa_id" IS NOT NULL AND e."id" IS NULL);

DELETE FROM "schs2vet"."tb_faturas" f
 WHERE f."empresa_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "schs2vet"."tb_empresas" e WHERE e."id" = f."empresa_id");

DELETE FROM "schs2vet"."tb_fornecedores" x
 WHERE x."empresa_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "schs2vet"."tb_empresas" e WHERE e."id" = x."empresa_id");

DELETE FROM "schs2vet"."tb_tratadores" x
 WHERE x."empresa_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "schs2vet"."tb_empresas" e WHERE e."id" = x."empresa_id");

DELETE FROM "schs2vet"."tb_audit_logs" x
 WHERE x."empresaId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "schs2vet"."tb_empresas" e WHERE e."id" = x."empresaId");

DELETE FROM "schs2vet"."tb_ai_usage_logs" x
 WHERE x."empresa_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "schs2vet"."tb_empresas" e WHERE e."id" = x."empresa_id");

-- ── 2. FKs com RESTRICT — a porta fechada ──────────────────────────────────
ALTER TABLE "schs2vet"."tb_faturas"
  ADD CONSTRAINT "tb_faturas_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_fornecedores"
  ADD CONSTRAINT "tb_fornecedores_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_tratadores"
  ADD CONSTRAINT "tb_tratadores_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_audit_logs"
  ADD CONSTRAINT "tb_audit_logs_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_ai_usage_logs"
  ADD CONSTRAINT "tb_ai_usage_logs_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
