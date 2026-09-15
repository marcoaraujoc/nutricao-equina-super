-- ════════════════════════════════════════════════════════════════════════════
-- PRODUTOS DE FORNECEDOR + CONTAS A PAGAR (2026-09-10)
--
-- 🔴 O QUE ESTA MIGRATION RESOLVE — duas ausências que se sustentavam uma na outra:
--
--   1. A clínica só sabia falar de item que ELA GUARDA. `tb_estoque_clinica` e
--      `tb_lotes_vacina` são ESTOQUE FÍSICO: quantidade, lote, validade. O item que
--      a clínica NÃO estoca — pede ao fornecedor quando o vet prescreve — não tinha
--      onde existir. Na tela de prescrição ele aparecia como "Sem estoque", cinza,
--      igual ao que ninguém fornece; o vet não tinha como saber que aquele item é
--      pedível, nem de quem.
--
--   2. Não existia o outro lado do balcão da compra. `tb_faturas` é o que a clínica
--      COBRA do cliente. O que ela DEVE ao fornecedor (e ao prestador) não era
--      apurado em lugar nenhum — o recibo de prestador lia o ledger de execução
--      direto, sem ciclo de abrir/fechar/pagar.
--
-- Três objetos + duas colunas, todos ADITIVOS. NENHUM UPDATE/DELETE de dado
-- gravado, nenhum backfill: item já cadastrado continua exatamente como está, e
-- estoque/fatura existentes não mudam de comportamento ao aplicar.
--
-- ⚠️ SEM `prisma generate` obrigatório para funcionar: tudo é lido e gravado por
-- SQL cru em `lib/produtoFornecedor.js` e `lib/contasPagar.js` — no Windows o
-- generate falha com o backend rodando (§11).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. PRODUTO DE FORNECEDOR ────────────────────────────────────────────────
--
-- "De quem eu compro este item, e por quanto." NÃO é estoque: não tem quantidade,
-- lote nem validade, porque o item não está na clínica — ele é pedido quando
-- prescrito.
--
-- ⚠️ É por (empresa, medicamento, fornecedor) e não por (empresa, medicamento):
-- o mesmo item costuma ter mais de um fornecedor, com preços diferentes, e
-- guardar UM só obrigaria a apagar o outro para trocar de cotação.
--
-- ⚠️ `medicamento_id` aponta para `tb_medicamentos`, que é o catálogo dos DOIS
-- (medicamento e vacina — a vacina é a linha cuja `classificacao` contém "vacin").
-- Uma tabela por tipo duplicaria a mesma regra de compra em dois lugares.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_produtos_fornecedor" (
  "id"             SERIAL       PRIMARY KEY,
  "empresa_id"     INTEGER      NOT NULL,
  "medicamento_id" INTEGER      NOT NULL,
  "fornecedor_id"  INTEGER      NOT NULL,
  -- Preço de COMPRA (o que a clínica paga ao fornecedor pela unidade).
  -- NULL = "compro dele, mas o preço não foi cadastrado" — diferente de 0, que
  -- afirmaria que o fornecedor entrega de graça.
  "valor_unitario" DOUBLE PRECISION,
  -- Preço de VENDA sugerido (o que a clínica cobra do cliente). NULL = usa o que
  -- a tela de origem já resolve hoje; não se inventa margem.
  "valor_venda"    DOUBLE PRECISION,
  -- Unidade em que o preço acima está expresso (mL, g, dose, frasco…). NULL =
  -- a unidade do próprio catálogo.
  "unidade"        VARCHAR(30),
  "nota_fiscal"    VARCHAR(100),
  "observacao"     TEXT,
  "ativo"          BOOLEAN      NOT NULL DEFAULT true,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_produtos_fornecedor_unico"
  ON "schs2vet"."tb_produtos_fornecedor" ("empresa_id", "medicamento_id", "fornecedor_id");

CREATE INDEX IF NOT EXISTS "tb_produtos_fornecedor_empresa_id_idx"
  ON "schs2vet"."tb_produtos_fornecedor" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_produtos_fornecedor_medicamento_id_idx"
  ON "schs2vet"."tb_produtos_fornecedor" ("medicamento_id");
CREATE INDEX IF NOT EXISTS "tb_produtos_fornecedor_fornecedor_id_idx"
  ON "schs2vet"."tb_produtos_fornecedor" ("fornecedor_id");

-- ── 2. CONTA A PAGAR (fornecedor E prestador) ───────────────────────────────
--
-- 🔴 UMA tabela para os dois, separados por `tipo`. São o MESMO documento — o que
-- a clínica deve a um terceiro, com ciclo de abrir/fechar/pagar — e duas tabelas
-- dariam duas telas, dois totalizadores e duas regras de fechamento que
-- divergiriam na primeira correção. É o espelho de `tb_faturas`, que também é uma
-- só para todo tipo de item cobrado.
--
-- ⚠️ `credor_id` é o id do FORNECEDOR (`tb_fornecedores`) ou do PRESTADOR
-- (`tb_prestadores`) conforme o `tipo` — as duas tabelas são independentes desde
-- 2026-08-21 e não há id compartilhado entre elas. SEM FK, pelo mesmo motivo de
-- `tb_prescricoes.prestador_id`: a conta a pagar é registro financeiro e não
-- desaparece nem muda de dono porque um cadastro foi excluído.
--
-- ⚠️ `credor_nome` é GRAVADO (snapshot): a conta precisa dizer a quem se deve
-- mesmo que o cadastro seja renomeado ou inativado depois.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_contas_pagar" (
  "id"             SERIAL       PRIMARY KEY,
  "empresa_id"     INTEGER      NOT NULL,
  -- FORNECEDOR | PRESTADOR
  "tipo"           VARCHAR(20)  NOT NULL,
  "credor_id"      INTEGER      NOT NULL,
  "credor_nome"    VARCHAR(255) NOT NULL DEFAULT '',
  -- "2026-09" — o ciclo, como em `tb_faturas.mes_referencia`.
  "mes_referencia" VARCHAR(7),
  "total"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- ABERTA | FECHADA | PAGA | CANCELADA
  -- ⚠️ VARCHAR(20) comporta o maior valor previsto; status novo aqui exige conferir
  -- o comprimento antes (a armadilha de `CANCELADO_AUTOMATICAMENTE`, 2026-08-23).
  "status"         VARCHAR(20)  NOT NULL DEFAULT 'ABERTA',
  "observacao"     TEXT,
  "pago_em"        TIMESTAMP(3),
  "pago_por_id"    INTEGER,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UMA conta ABERTA por (empresa, tipo, credor, mês). É o que impede duas contas
-- correntes do mesmo fornecedor partirem o mês em duas — a mesma guarda que
-- `abrirProximaFatura` faz do lado do cliente.
-- ⚠️ Índice PARCIAL (só ABERTA): a conta FECHADA/PAGA do mês anterior tem de
-- coexistir com a nova. E, sendo parcial, todo `ON CONFLICT` sobre ele precisa
-- REPETIR o predicado (armadilha 42P10 de 2026-09-09).
CREATE UNIQUE INDEX IF NOT EXISTS "tb_contas_pagar_aberta_unica"
  ON "schs2vet"."tb_contas_pagar" ("empresa_id", "tipo", "credor_id", "mes_referencia")
  WHERE "status" = 'ABERTA';

CREATE INDEX IF NOT EXISTS "tb_contas_pagar_empresa_id_idx"
  ON "schs2vet"."tb_contas_pagar" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_contas_pagar_credor_idx"
  ON "schs2vet"."tb_contas_pagar" ("empresa_id", "tipo", "credor_id", "status");

-- ── 3. ITEM DA CONTA A PAGAR ────────────────────────────────────────────────
--
-- O que o pedido exige que apareça: o ANIMAL, o valor, a data e QUEM solicitou.
--
-- ⚠️ `animal_nome` e `descricao` são GRAVADOS junto do id, pela mesma razão do
-- ledger do prestador: a conta tem de dizer o que foi consumido mesmo que o
-- paciente seja renomeado ou o item saia do catálogo.
--
-- ⚠️ `origem_tipo`/`origem_id` guardam DE ONDE a linha nasceu (PRESCRICAO_ITEM,
-- VACINA, EXECUCAO_PRESTADOR) e são o que torna o lançamento IDEMPOTENTE: a
-- execução pode ser reprocessada e o índice único abaixo recusa a segunda linha.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_conta_pagar_itens" (
  "id"             SERIAL       PRIMARY KEY,
  "conta_id"       INTEGER      NOT NULL,
  "animal_id"      INTEGER,
  "animal_nome"    VARCHAR(255) NOT NULL DEFAULT '',
  "descricao"      TEXT         NOT NULL,
  "quantidade"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  "valor"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Quem SOLICITOU (prescreveu o medicamento / pediu a vacina / executou o
  -- procedimento). É o "quem fez a solicitação" do pedido.
  "solicitante_id" INTEGER,
  "solicitante_nome" VARCHAR(255) NOT NULL DEFAULT '',
  -- Data do fato gerador (a execução), não a do lançamento.
  "ocorrido_em"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- PRESCRICAO_ITEM | VACINA | EXECUCAO_PRESTADOR | MANUAL
  "origem_tipo"    VARCHAR(30),
  "origem_id"      INTEGER,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tb_conta_pagar_itens_conta_fk"
    FOREIGN KEY ("conta_id") REFERENCES "schs2vet"."tb_contas_pagar"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "tb_conta_pagar_itens_conta_id_idx"
  ON "schs2vet"."tb_conta_pagar_itens" ("conta_id");
CREATE INDEX IF NOT EXISTS "tb_conta_pagar_itens_animal_id_idx"
  ON "schs2vet"."tb_conta_pagar_itens" ("animal_id");

-- IDEMPOTÊNCIA do lançamento automático: a mesma execução não vira duas linhas.
-- ⚠️ Parcial (só quando há origem), porque o lançamento MANUAL não tem origem e
-- vários lançamentos manuais na mesma conta são legítimos.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_conta_pagar_itens_origem_unica"
  ON "schs2vet"."tb_conta_pagar_itens" ("origem_tipo", "origem_id")
  WHERE "origem_tipo" IS NOT NULL AND "origem_id" IS NOT NULL;

-- ── 4. FORNECEDOR E NOTA FISCAL NO LOTE DE VACINA ───────────────────────────
--
-- `tb_estoque_clinica` (farmácia) JÁ tinha `fornecedor_id` e `nota_fiscal` desde
-- sempre; o lote de vacina, não — então a entrada de vacina não conseguia dizer
-- de quem veio o frasco, e a leitura de nota fiscal não teria onde gravar isso.
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ADD COLUMN IF NOT EXISTS "fornecedor_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "nota_fiscal"   VARCHAR(100);

CREATE INDEX IF NOT EXISTS "tb_lotes_vacina_fornecedor_id_idx"
  ON "schs2vet"."tb_lotes_vacina" ("fornecedor_id");

-- ── 5. RLS — TENANT DIRETO nas três tabelas novas ───────────────────────────
--
-- As três têm o dono explícito: `empresa_id` nas duas primeiras, e a terceira
-- herda pela conta (tenant VIA PAI, como `tb_fatura_itens`). Sem o
-- `app_empresa_id()` carimbado nada passa, exceto o ADMIN da plataforma.
-- ⚠️ FORCE vale até para o dono do schema — é por isso que backfill de migration
-- em tabela assim precisa de `set_config('app.plataforma', ...)` (armadilha 42).
-- Aqui não há backfill, então não é necessário.

ALTER TABLE "schs2vet"."tb_produtos_fornecedor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_produtos_fornecedor" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_tb_produtos_fornecedor" ON "schs2vet"."tb_produtos_fornecedor"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

ALTER TABLE "schs2vet"."tb_contas_pagar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_contas_pagar" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_tb_contas_pagar" ON "schs2vet"."tb_contas_pagar"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));

-- Item: TENANT VIA PAI. Não tem `empresa_id` próprio de propósito — duplicar o
-- dono em duas tabelas cria a possibilidade de eles DIVERGIREM, e aí não há qual
-- dos dois acreditar. Mesma modelagem de `tb_fatura_itens`.
ALTER TABLE "schs2vet"."tb_conta_pagar_itens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_conta_pagar_itens" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_tb_conta_pagar_itens" ON "schs2vet"."tb_conta_pagar_itens"
  USING (
    "schs2vet"."app_plataforma"() OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_contas_pagar" c
       WHERE c."id" = "conta_id" AND c."empresa_id" = "schs2vet"."app_empresa_id"()
    )
  )
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_contas_pagar" c
       WHERE c."id" = "conta_id" AND c."empresa_id" = "schs2vet"."app_empresa_id"()
    )
  );
