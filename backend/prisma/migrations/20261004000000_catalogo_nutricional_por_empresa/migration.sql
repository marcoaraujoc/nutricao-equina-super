-- ════════════════════════════════════════════════════════════════════════════
-- O CATÁLOGO NUTRICIONAL passa de GLOBAL PURO para CATÁLOGO MISTO
-- (tb_alimentos, tb_nutrientes, tb_composicao_alimento)
--
-- POR QUÊ: até aqui as três eram catálogo do sistema, sem `empresa_id` e sem RLS —
-- criar/editar/excluir era ADMIN-only e a clínica não tinha onde cadastrar o alimento
-- que ela usa e o sistema não conhece. Passam a seguir a MESMA forma de
-- `tb_medicamentos` / `tb_procedimentos_vet` / `tb_especialidades`:
--   empresa_id IS NULL  → linha GLOBAL do sistema. Toda clínica LÊ, só o ADMIN escreve.
--   empresa_id setado   → cadastrada por aquela clínica. Só ela vê, edita e exclui.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- Policy ASSIMÉTRICA, idêntica à de `tb_medicamentos` (migration 20260806220000):
--   USING      → lê o global (empresa_id IS NULL) OU o próprio (= tenant)
--   WITH CHECK → só escreve o próprio — nenhuma clínica cria nem altera linha global
-- O `OR empresa_id IS NULL` do USING é o que mantém o catálogo atual (13 alimentos,
-- 296 composições e os nutrientes do seed) visível em TODAS as empresas; sem ele, a
-- tela de Dieta, o Relatório Nutricional e a Análise NRC ficariam vazios em todo lugar.
--
-- ⚠️ Quem escreve linha GLOBAL é a sessão com `app.plataforma = on`
-- (`comEscopoPlataforma`, usado pelos seeds e pelo ADMIN da plataforma nos
-- controllers). Sessão sem tenant e sem esse carimbo NÃO grava: `empresa_id =
-- app_empresa_id()` com os dois NULL avalia NULL, e RLS trata NULL como falso.
--
-- ── UNICIDADE ──────────────────────────────────────────────────────────────
-- ⚠️ O `UNIQUE (alimento_id, nutriente_id)` de `tb_composicao_alimento` FICA COMO ESTÁ,
-- de propósito — e é a diferença em relação a `tb_especialidades`, que virou dois
-- índices parciais. Aqui o par alimento×nutriente alimenta o CÁLCULO da dieta
-- (services/nrcCalculatorEquino.js): permitir uma linha global e outra da empresa para
-- o MESMO par faria o mesmo nutriente ser contado duas vezes, ou o cálculo escolher uma
-- das duas sem critério. Consequência aceita: a clínica não sobrescreve o valor de um
-- nutriente num alimento GLOBAL — para ter valores próprios, cadastra o alimento dela.
--
-- Aplicar com `migrate deploy`. Depois, `npx prisma generate` para o Client conhecer
-- `Alimento.empresaId` / `Nutriente.empresaId` / `ComposicaoAlimento.empresaId`
-- (no Windows o generate falha com o backend rodando — CLAUDE.md §11).
--
-- SEM BACKFILL: toda linha existente fica com `empresa_id` NULO, que é exatamente o
-- que ela sempre foi — catálogo do sistema. Nenhuma empresa muda de comportamento.
-- ════════════════════════════════════════════════════════════════════════════

-- ── tb_alimentos ────────────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_alimentos"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_alimentos_empresa_id_idx"
  ON "schs2vet"."tb_alimentos" ("empresa_id");

ALTER TABLE "schs2vet"."tb_alimentos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_alimentos" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_alimentos" ON "schs2vet"."tb_alimentos";
CREATE POLICY "tenant_tb_alimentos" ON "schs2vet"."tb_alimentos"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

COMMENT ON COLUMN "schs2vet"."tb_alimentos"."empresa_id" IS
  'NULL = alimento global do sistema. Setado = cadastrado pela clínica, visível só para ela.';

-- ── tb_nutrientes ───────────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_nutrientes"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_nutrientes_empresa_id_idx"
  ON "schs2vet"."tb_nutrientes" ("empresa_id");

ALTER TABLE "schs2vet"."tb_nutrientes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_nutrientes" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_nutrientes" ON "schs2vet"."tb_nutrientes";
CREATE POLICY "tenant_tb_nutrientes" ON "schs2vet"."tb_nutrientes"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

COMMENT ON COLUMN "schs2vet"."tb_nutrientes"."empresa_id" IS
  'NULL = nutriente global do sistema. Setado = cadastrado pela clínica, visível só para ela.';

-- ── tb_composicao_alimento ──────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_composicao_alimento"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_composicao_alimento_empresa_id_idx"
  ON "schs2vet"."tb_composicao_alimento" ("empresa_id");

ALTER TABLE "schs2vet"."tb_composicao_alimento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_composicao_alimento" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_composicao_alimento" ON "schs2vet"."tb_composicao_alimento";
CREATE POLICY "tenant_tb_composicao_alimento" ON "schs2vet"."tb_composicao_alimento"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

COMMENT ON COLUMN "schs2vet"."tb_composicao_alimento"."empresa_id" IS
  'NULL = composição global do sistema. Setada = cadastrada pela clínica, visível só para ela.';
