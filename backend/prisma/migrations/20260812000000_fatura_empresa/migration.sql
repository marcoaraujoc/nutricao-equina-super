-- Fatura POR EMPRESA — segregação entre clínicas.
--
-- POR QUÊ: o mesmo cliente é atendido por várias clínicas (multi-tenant). Sem empresa
-- na fatura, TODA busca era `{ proprietarioId, status: 'ABERTA' }` — logo a clínica B
-- lançava prescrição/vacina/exame na fatura ABERTA da clínica A e cada uma enxergava os
-- itens da outra. Modelo correto: EmpresaA-Cliente-Fatura e EmpresaB-Cliente-Fatura,
-- independentes.
--
-- SEM FK, de propósito: mesmo critério de EvolucaoClinica.empresaId e
-- AgendamentoClinico.empresaId — o registro financeiro sobrevive à exclusão da empresa.

ALTER TABLE "schs2vet"."tb_faturas" ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

-- Escopo das buscas de fatura aberta: (proprietário, empresa, status)
CREATE INDEX IF NOT EXISTS "tb_faturas_empresa_id_idx"
  ON "schs2vet"."tb_faturas" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_faturas_proprietarioId_empresa_id_status_idx"
  ON "schs2vet"."tb_faturas" ("proprietarioId", "empresa_id", "status");

-- ── BACKFILL 1: empresa dos ANIMAIS dos itens da fatura ──────────────────────
-- Fonte mais confiável: o item foi lançado para um animal, e o animal tem dono de
-- tenancy. Só aplica quando TODOS os animais da fatura são da MESMA empresa — havendo
-- divergência a fatura fica null e é resolvida manualmente (não se inventa o rateio).
UPDATE "schs2vet"."tb_faturas" f
SET "empresa_id" = sub.empresa_id
FROM (
  SELECT fi."faturaId"                        AS fatura_id,
         MIN(a."empresaId")                   AS empresa_id,
         COUNT(DISTINCT a."empresaId")        AS quantas
  FROM "schs2vet"."tb_fatura_itens" fi
  JOIN "schs2vet"."tb_animais" a ON a.id = fi."animalId"
  WHERE a."empresaId" IS NOT NULL
  GROUP BY fi."faturaId"
) sub
WHERE f.id = sub.fatura_id
  AND sub.quantas = 1
  AND f."empresa_id" IS NULL;

-- ── BACKFILL 2: fatura sem item (ou sem animal) → perfil ÚNICO do proprietário ──
-- Se o cliente só tem cadastro numa empresa, não há ambiguidade possível.
UPDATE "schs2vet"."tb_faturas" f
SET "empresa_id" = sub.empresa_id
FROM (
  SELECT pp.user_id                     AS user_id,
         MIN(pp.empresa_id)             AS empresa_id,
         COUNT(DISTINCT pp.empresa_id)  AS quantas
  FROM "schs2vet"."tb_proprietario_perfis" pp
  GROUP BY pp.user_id
) sub
WHERE f."proprietarioId" = sub.user_id
  AND sub.quantas = 1
  AND f."empresa_id" IS NULL;

-- ── BACKFILL 3: último recurso — empresa do animal legado da própria fatura ────
UPDATE "schs2vet"."tb_faturas" f
SET "empresa_id" = a."empresaId"
FROM "schs2vet"."tb_animais" a
WHERE a.id = f."animalId"
  AND a."empresaId" IS NOT NULL
  AND f."empresa_id" IS NULL;

-- Faturas que sobrarem com empresa_id NULL são legado sem tenancy dedutível: continuam
-- visíveis pela regra de compatibilidade do código (fatura sem empresa é tratada como
-- da empresa do contexto que a abrir) e ganham a empresa no próximo lançamento.
