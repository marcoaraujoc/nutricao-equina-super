-- ════════════════════════════════════════════════════════════════════════════
-- tb_especialidades passa de CATÁLOGO GLOBAL PURO para CATÁLOGO MISTO
--
-- POR QUÊ: o encaminhamento para profissional EXTERNO exige uma especialidade, e o
-- catálogo (72 itens semeados por scripts/seedEspecialidades.js) é o que a clínica
-- atende — a especialidade de quem é de fora (quiropraxia, acupuntura, odontologia
-- equina...) muitas vezes não está lá. Até aqui o campo era um <select> fechado: o
-- formulário exigia um valor que a tela não tinha como informar.
--
-- A partir daqui a clínica cadastra a especialidade que faltar, e essa linha é DELA:
--   empresa_id IS NULL  → especialidade GLOBAL do sistema (o seed). Toda clínica LÊ,
--                         nenhuma ESCREVE — é catálogo compartilhado.
--   empresa_id setado   → cadastrada à mão por aquela clínica. Só ela vê e edita.
-- É a MESMA forma de `tb_medicamentos` / `tb_procedimentos_vet` (catálogo do ADMIN +
-- item manual da empresa, lib/catalogoManual.js) e de `tb_documento_templates`.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- A policy é ASSIMÉTRICA, como a de `tb_medicamentos`:
--   USING      → lê o global (empresa_id IS NULL) OU o próprio (= tenant)
--   WITH CHECK → só escreve o próprio — nenhuma clínica cria nem altera linha global
-- O `OR empresa_id IS NULL` no USING é o que mantém os 72 itens do seed visíveis para
-- todo mundo; sem ele, Cadastro Pessoal, Novo Membro, Novo Fornecedor e o filtro de
-- especialidade da Agenda ficariam vazios em TODAS as empresas.
--
-- ⚠️ Sessão SEM tenant (seed, script de manutenção) continua enxergando e escrevendo o
-- catálogo GLOBAL: `empresa_id IS NULL` é verdadeiro ali, e o WITH CHECK aceita
-- `empresa_id = app_empresa_id()` quando ambos são NULL. É o que preserva
-- `scripts/seedEspecialidades.js` funcionando como sempre funcionou.
--
-- ── UNICIDADE ──────────────────────────────────────────────────────────────
-- O unique antigo era (nome, especie_id) e impedia a clínica de cadastrar qualquer
-- nome que já existisse no global. Ele dá lugar a DOIS índices PARCIAIS:
--   · global  → (nome, especie_id)             WHERE empresa_id IS NULL
--   · empresa → (nome, especie_id, empresa_id) WHERE empresa_id IS NOT NULL
-- Um `UNIQUE (nome, especie_id, empresa_id)` simples NÃO serviria: no Postgres dois
-- NULL são distintos, então o catálogo global ficaria SEM proteção contra duplicata.
-- Índice parcial não é declarável no schema.prisma — por isso mora só aqui, e o model
-- perdeu o `@@unique`. Aplicar com `migrate deploy` (o projeto já não usa `migrate dev`).
--
-- Depois de aplicar: `npx prisma generate` é OBRIGATÓRIO — o Client precisa conhecer
-- `Especialidade.empresaId` para o cadastro manual e para o escopo da listagem.
-- Conferir que a listagem continua devolvendo os 72 itens globais em uma empresa
-- qualquer; se cair para os poucos itens dela, a policy saiu errada.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_especialidades"
  ADD COLUMN IF NOT EXISTS "empresa_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_especialidades_empresa_id_idx"
  ON "schs2vet"."tb_especialidades" ("empresa_id");

-- Sai o unique total; entram os dois parciais (ver o cabeçalho).
ALTER TABLE "schs2vet"."tb_especialidades"
  DROP CONSTRAINT IF EXISTS "tb_especialidades_nome_especie_id_key";
DROP INDEX IF EXISTS "schs2vet"."tb_especialidades_nome_especie_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tb_especialidades_nome_especie_global_key"
  ON "schs2vet"."tb_especialidades" ("nome", "especie_id")
  WHERE "empresa_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "tb_especialidades_nome_especie_empresa_key"
  ON "schs2vet"."tb_especialidades" ("nome", "especie_id", "empresa_id")
  WHERE "empresa_id" IS NOT NULL;

-- RLS — CATÁLOGO MISTO (espelha "tenant_tb_medicamentos", migration 20260806220000)
ALTER TABLE "schs2vet"."tb_especialidades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_especialidades" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_especialidades" ON "schs2vet"."tb_especialidades";
CREATE POLICY "tenant_tb_especialidades" ON "schs2vet"."tb_especialidades"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"() OR "empresa_id" IS NULL))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

COMMENT ON COLUMN "schs2vet"."tb_especialidades"."empresa_id" IS
  'NULL = especialidade global do sistema (seed). Setado = cadastrada pela clínica, visível só para ela.';
