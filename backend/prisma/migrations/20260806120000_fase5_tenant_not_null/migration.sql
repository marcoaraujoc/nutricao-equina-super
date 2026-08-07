-- ════════════════════════════════════════════════════════════════════════════
-- FASE 5 DO MULTI-TENANCY — a coluna de tenant vira OBRIGATÓRIA
-- (docs/MULTI-TENANCY-PLANO.md §6, linha "5. Coluna de tenant")
--
-- Sem RLS ainda. Aqui só se estabelece a INVARIANTE de que o RLS vai depender:
-- **toda linha de tabela de tenant pertence a exatamente uma empresa.**
-- Com `empresa_id` nulável, uma policy `empresa_id = current_setting(...)` deixa a
-- linha nula invisível para todos e editável por ninguém — ou, pior, visível a todos
-- se alguém "consertar" a policy com um `OR IS NULL`.
--
-- BACKFILL: não há. As fases 3 e 4 zeraram as órfãs; `scripts/inventarioTenancy.js`
-- acusa **0 registros órfãos** em todas as tabelas com caminho até a empresa.
--
-- ── PARTE 1 — SET NULL → RESTRICT ───────────────────────────────────────────
-- Três FKs para `tb_empresas` eram `ON DELETE SET NULL`. Combinadas com o `NOT NULL`
-- da parte 2, elas produziriam um erro obscuro de constraint no dia em que alguém
-- apagasse uma empresa. `RESTRICT` diz a mesma coisa de forma explícita e, sobretudo,
-- **torna o órfão estruturalmente impossível**: o banco passa a recusar o DELETE que
-- deixaria filhos sem dono.
--
-- É a mesma decisão da EXCLUSÃO LÓGICA (§2.5 do plano): empresa não se apaga, se
-- INATIVA (`tb_empresas.status`). O `RESTRICT` é essa regra escrita no schema, e não
-- só na aplicação.
--
-- `users.empresa_id` NÃO entra: é control plane, a coluna é legada e continua nulável.
--
-- ── PARTE 2 — NOT NULL ──────────────────────────────────────────────────────
-- Aplicado às tabelas de TENANT DIRETO cujo nulo não tem significado legítimo.
--
-- ⚠️ FICAM DE FORA, e o motivo importa:
--   tb_audit_logs, tb_ai_usage_logs  → o nulo é EVENTO DE PLATAFORMA, não sujeira.
--       LOGIN/LOGOUT acontecem antes de haver empresa resolvida, e chamada de IA de
--       ADMIN global não tem pagador. Forçar um tenant ali inventaria dado. Ficam
--       nuláveis com a policy (b) — `empresa_id = tenant`, SEM `OR IS NULL` —, o que
--       já os torna visíveis apenas ao ADMIN (D11).
--   tb_medicamentos, tb_procedimentos_vet, tb_localizacoes_animal, tb_fornecedores,
--   tb_midia_arquivos                → CATÁLOGO MISTO (§4.1, forma 2): o nulo é a
--       LINHA GLOBAL, compartilhada por todas as clínicas. Policy
--       `empresa_id = tenant OR <predicado de global>`.
-- ════════════════════════════════════════════════════════════════════════════

-- ── PARTE 1 ─────────────────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_animais"
  DROP CONSTRAINT "tb_animais_empresaId_fkey";
ALTER TABLE "schs2vet"."tb_animais"
  ADD CONSTRAINT "tb_animais_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_estoque_clinica"
  DROP CONSTRAINT "tb_estoque_clinica_empresaId_fkey";
ALTER TABLE "schs2vet"."tb_estoque_clinica"
  ADD CONSTRAINT "tb_estoque_clinica_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schs2vet"."tb_lotes_vacina"
  DROP CONSTRAINT "tb_lotes_vacina_empresa_id_fkey";
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ADD CONSTRAINT "tb_lotes_vacina_empresa_id_fkey"
  FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── PARTE 2 ─────────────────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_animais"                ALTER COLUMN "empresaId"  SET NOT NULL;
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"  ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"     ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_prescricao_grupos"      ALTER COLUMN "empresaId"  SET NOT NULL;
ALTER TABLE "schs2vet"."tb_faturas"                ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_tratadores"             ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_estoque_clinica"        ALTER COLUMN "empresaId"  SET NOT NULL;
ALTER TABLE "schs2vet"."tb_lotes_vacina"           ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_usuario_especialidades" ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_resumo_atendimento_ia"  ALTER COLUMN "empresa_id" SET NOT NULL;
ALTER TABLE "schs2vet"."tb_fatura_item_catalogo"   ALTER COLUMN "empresa_id" SET NOT NULL;

-- ── PARTE 3 — índices TENANT-FIRST ──────────────────────────────────────────
-- A empresa passa a ser o primeiro predicado de TODA consulta (é o que a policy do
-- RLS acrescenta), então ela precisa ser a primeira coluna do índice. 39 índices já
-- citavam a empresa; aqui entram os compostos que faltavam nos caminhos mais quentes.
CREATE INDEX IF NOT EXISTS "idx_animais_empresa_ativo"
  ON "schs2vet"."tb_animais" ("empresaId", "ativo");
CREATE INDEX IF NOT EXISTS "idx_evolucoes_empresa_animal"
  ON "schs2vet"."tb_evolucoes_clinicas" ("empresa_id", "animalId");
CREATE INDEX IF NOT EXISTS "idx_prescricao_grupos_empresa_animal"
  ON "schs2vet"."tb_prescricao_grupos" ("empresaId", "animalId", "status");
CREATE INDEX IF NOT EXISTS "idx_tratadores_empresa_ativo"
  ON "schs2vet"."tb_tratadores" ("empresa_id", "ativo");
CREATE INDEX IF NOT EXISTS "idx_estoque_empresa_ativo"
  ON "schs2vet"."tb_estoque_clinica" ("empresaId", "ativo");
CREATE INDEX IF NOT EXISTS "idx_lotes_vacina_empresa_ativo"
  ON "schs2vet"."tb_lotes_vacina" ("empresa_id", "ativo");
