-- ════════════════════════════════════════════════════════════════════════════
-- PRESTADOR NO PROCEDIMENTO + RECIBO DE PAGAMENTO (2026-09-08)
--
-- 🔴 O QUE ESTA MIGRATION RESOLVE: até aqui o preço de um procedimento era UM só
-- por empresa (`tb_procedimento_valores_empresa.valor`) e ninguém sabia QUEM o
-- executou. Duas consequências:
--   • a mesma clínica não podia ter dois prestadores fazendo o MESMO procedimento
--     com valores e comissionamentos diferentes — o segundo sobrescrevia o primeiro;
--   • não havia como apurar o que a clínica DEVE a cada prestador: `FaturaItem`
--     registra o que se COBRA do cliente, e não existia o outro lado do balcão.
--
-- Três objetos, todos ADITIVOS (nenhum UPDATE/DELETE de dado gravado):
--
-- 1. `tb_procedimento_prestadores` — o VÍNCULO (empresa, procedimento, prestador),
--    com os DOIS valores: `valor_cliente` (o que se cobra do cliente quando é ESTE
--    prestador que executa) e `valor_prestador` (o que ELE cobra da clínica).
--    ⚠️ `tb_procedimento_valores_empresa` CONTINUA existindo e continua sendo o
--    valor PADRÃO do procedimento na empresa — o que vale quando o item é
--    executado pela própria equipe, sem prestador externo. O vínculo só ESTREITA
--    para o par (procedimento, prestador); trocar um pelo outro faria todo
--    procedimento sem prestador nascer sem preço na fatura.
--
-- 2. `tb_prescricoes.prestador_id` — QUAL prestador vai executar ESTE item.
--    Fica no ITEM, não no grupo: a mesma prescrição pode ter o bloqueio feito pelo
--    veterinário da casa e o ferrageamento pelo ferrador externo, e uma marca por
--    documento obrigaria a abrir duas prescrições para o mesmo atendimento — a
--    mesma razão de `medicamento_cliente`/`aplicada_pelo_proprietario` serem por item.
--
-- 3. `tb_execucoes_procedimento_prestador` — o LEDGER que sustenta o recibo.
--    🔴 É SNAPSHOT, e por isso é tabela e não uma consulta: o valor cobrado do
--    cliente, o valor do prestador e a FORMA DE PAGAMENTO dele mudam com o tempo.
--    Um recibo de março recalculado com o percentual de setembro pagaria valor
--    diferente do que foi acordado, e não haveria como provar o contrário. Mesma
--    premissa de `FaturaItem.descricao` e do snapshot do documento emitido.
--    ⚠️ Uma linha por EXECUÇÃO — a regra de cobrança não muda: procedimento só
--    entra na fatura (e aqui) depois de executado.
--
-- Sem backfill: execução ANTERIOR a esta migration não tem prestador registrado e
-- não pode ganhar um por dedução — `FaturaItem` guarda quem LANÇOU a cobrança
-- (`veterinario_id`), não quem executou o procedimento. Recibo passa a valer daqui
-- em diante.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Vínculo prestador × procedimento ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_procedimento_prestadores" (
  "id"              SERIAL       PRIMARY KEY,
  "empresa_id"      INTEGER      NOT NULL,
  "procedimento_id" INTEGER      NOT NULL,
  "prestador_id"    INTEGER      NOT NULL,
  -- O que a clínica cobra do CLIENTE quando é ESTE prestador que executa.
  -- NULL = usa o valor padrão da empresa (tb_procedimento_valores_empresa) — é o
  -- que permite vincular o prestador sem repetir um preço que já existe.
  "valor_cliente"   DOUBLE PRECISION,
  -- O que ESTE prestador cobra da clínica por este procedimento. Vai ao recibo
  -- quando o tipo de pagamento dele é POR_PROCEDIMENTO.
  "valor_prestador" DOUBLE PRECISION,
  "ativo"           BOOLEAN      NOT NULL DEFAULT true,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UM vínculo por (empresa, procedimento, prestador). Vários prestadores no MESMO
-- procedimento é justamente o caso de uso — o que não pode existir é a mesma
-- dupla duas vezes, com dois preços, sem ninguém saber qual vale.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_procedimento_prestadores_unico"
  ON "schs2vet"."tb_procedimento_prestadores" ("empresa_id", "procedimento_id", "prestador_id");

CREATE INDEX IF NOT EXISTS "tb_procedimento_prestadores_empresa_id_idx"
  ON "schs2vet"."tb_procedimento_prestadores" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_procedimento_prestadores_prestador_id_idx"
  ON "schs2vet"."tb_procedimento_prestadores" ("prestador_id");
CREATE INDEX IF NOT EXISTS "tb_procedimento_prestadores_procedimento_id_idx"
  ON "schs2vet"."tb_procedimento_prestadores" ("procedimento_id");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_procedimento_prestadores"
    ADD CONSTRAINT "tb_procedimento_prestadores_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_procedimento_prestadores"
    ADD CONSTRAINT "tb_procedimento_prestadores_procedimento_id_fkey"
    FOREIGN KEY ("procedimento_id") REFERENCES "schs2vet"."tb_procedimentos_vet"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_procedimento_prestadores"
    ADD CONSTRAINT "tb_procedimento_prestadores_prestador_id_fkey"
    FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."tb_prestadores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ── 2. Prestador do ITEM de prescrição ──────────────────────────────────────
-- Sem FK de propósito, por DUAS razões: (a) `tb_prescricoes` é prontuário — o item
-- não pode ser levado nem alterado porque um cadastro de prestador foi excluído;
-- (b) `ON DELETE SET NULL` apagaria de quem era o procedimento, e o ledger do
-- recibo (objeto 3) já guarda o vínculo de forma imutável.
ALTER TABLE "schs2vet"."tb_prescricoes"
  ADD COLUMN IF NOT EXISTS "prestador_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_prescricoes_prestador_id_idx"
  ON "schs2vet"."tb_prescricoes" ("prestador_id");

-- ── 3. Ledger de execução (base do recibo) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_execucoes_procedimento_prestador" (
  "id"                SERIAL           PRIMARY KEY,
  "empresa_id"        INTEGER          NOT NULL,
  "prestador_id"      INTEGER          NOT NULL,
  -- Origem clínica. Sem FK pela mesma razão do item 2 — e o recibo tem de
  -- sobreviver ao cancelamento da prescrição que o originou: o serviço foi
  -- prestado, e o que se faz com a cobrança do cliente é outra decisão.
  "prescricao_id"     INTEGER,
  "animal_id"         INTEGER          NOT NULL,
  -- Nome do animal e do procedimento GRAVADOS: o recibo é documento de pagamento e
  -- precisa dizer o que foi feito, mesmo que o paciente seja renomeado ou o
  -- procedimento saia do catálogo depois.
  "animal_nome"       VARCHAR(255)     NOT NULL DEFAULT '',
  "procedimento_nome" VARCHAR(255)     NOT NULL DEFAULT '',
  "quantidade"        DOUBLE PRECISION NOT NULL DEFAULT 1,
  -- Valor cobrado DO CLIENTE nesta execução (o mesmo que foi para a fatura). É a
  -- base do cálculo quando a forma de pagamento do prestador é PERCENTUAL.
  "valor_cliente"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Valor que o prestador cobra por este procedimento, lido do vínculo no momento
  -- da execução. É o que vai ao recibo no tipo POR_PROCEDIMENTO.
  "valor_prestador"   DOUBLE PRECISION,
  -- Forma de pagamento DO PRESTADOR no momento da execução (snapshot).
  "tipo_pagamento"    VARCHAR(20),
  "forma_pagamento"   VARCHAR(20),
  "valor_pagamento"   DOUBLE PRECISION,
  -- Resultado do cálculo, congelado. Recalcular na leitura é o que faria um recibo
  -- antigo mudar de valor sozinho.
  "valor_a_pagar"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Como `valor_a_pagar` foi obtido, para o recibo poder explicar a conta:
  -- VALOR_PROCEDIMENTO | PERCENTUAL_CLIENTE | VALOR_FIXO | SALARIO | SEM_CONFIG
  "base_calculo"      VARCHAR(24)      NOT NULL DEFAULT 'SEM_CONFIG',
  "executado_em"      TIMESTAMP(3)     NOT NULL,
  "executado_por_id"  INTEGER,
  "fatura_item_id"    INTEGER,
  "created_at"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "tb_execucoes_proc_prestador_empresa_idx"
  ON "schs2vet"."tb_execucoes_procedimento_prestador" ("empresa_id");
-- O recibo é sempre "deste prestador, neste período": o índice é o trio.
CREATE INDEX IF NOT EXISTS "tb_execucoes_proc_prestador_periodo_idx"
  ON "schs2vet"."tb_execucoes_procedimento_prestador" ("empresa_id", "prestador_id", "executado_em");
CREATE INDEX IF NOT EXISTS "tb_execucoes_proc_prestador_prescricao_idx"
  ON "schs2vet"."tb_execucoes_procedimento_prestador" ("prescricao_id");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_execucoes_procedimento_prestador"
    ADD CONSTRAINT "tb_execucoes_proc_prestador_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- TENANT DIRETO nas duas tabelas novas. Fail-closed (fase 7c): sem
-- `app_empresa_id()` carimbado nada passa, exceto o ADMIN da plataforma.
-- ⚠️ FORCE vale até para o dono do schema — migration que precise fazer UPDATE
-- nestas tabelas tem de carimbar `app.plataforma` antes (armadilha 42).

ALTER TABLE "schs2vet"."tb_procedimento_prestadores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_procedimento_prestadores" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_procedimento_prestadores" ON "schs2vet"."tb_procedimento_prestadores";
CREATE POLICY "tenant_tb_procedimento_prestadores" ON "schs2vet"."tb_procedimento_prestadores"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

ALTER TABLE "schs2vet"."tb_execucoes_procedimento_prestador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_execucoes_procedimento_prestador" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_execucoes_procedimento_prestador" ON "schs2vet"."tb_execucoes_procedimento_prestador";
CREATE POLICY "tenant_tb_execucoes_procedimento_prestador" ON "schs2vet"."tb_execucoes_procedimento_prestador"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
