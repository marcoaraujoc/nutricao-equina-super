-- 🔴 FORMA DE CÁLCULO: a embalagem deixou de ser a própria unidade do item.
--
-- O DEFEITO: o frasco de 20 mL era cadastrado como "1 Un.", e uma dose de 5 mL
-- debitava 5 UNIDADES (cinco frascos) e cobrava cinco frascos — `mesmoGrupo('mL','Un.')`
-- é falso e a baixa caía no valor BRUTO, sem erro nenhum na tela.
--
-- Agora o produto declara QUANTO cabe na embalagem e EM QUÊ:
--     produto : Forma de Cálculo mL, Qtd 20
--     estoque : Qtd Produto 3   → Qtd Total 60 mL
--     receita : 5 mL            → estoque 55 mL
--     fatura  : 5 × 100 ÷ 20    = R$ 25,00
--
-- ADITIVA e SEM BACKFILL: `forma_calculo` nasce NULA e produto sem ela segue no
-- comportamento de sempre (a unidade da embalagem governa), então nenhum cadastro
-- existente muda de cobrança.
--
-- ⚠️ `doses_por_embalagem` MUDA DE SIGNIFICADO, não só de tipo: era "N aplicações por
-- frasco, desconta 1/N"; passa a ser "a embalagem contém N da forma de cálculo".
-- É seguro porque a coluna está VAZIA — medido nesta base: 8.255 medicamentos, ZERO
-- com `doses_por_embalagem` preenchido e ZERO com `multidose`. O nome da coluna fica
-- (mesmo precedente de `tb_procedimento_combos.valor`): renomear obrigaria a tocar
-- todos os leitores sem ganhar nada.
--
-- ⚠️ INTEGER → DOUBLE PRECISION nas quantidades: dose de 2,5 mL é rotina em equino, e
-- com coluna inteira ela seria truncada em SILÊNCIO — o estoque fecharia errado e
-- ninguém saberia por quê. Alargar não perde dado e não altera linha nenhuma.
-- (`tb_estoque_clinica.qtd_estoque` já era `double precision`.)

-- ── 1. O item do catálogo ────────────────────────────────────────────────────
ALTER TABLE "schs2vet"."tb_medicamentos"
  ADD COLUMN IF NOT EXISTS "forma_calculo" VARCHAR(20);

ALTER TABLE "schs2vet"."tb_medicamentos"
  ALTER COLUMN "doses_por_embalagem" TYPE DOUBLE PRECISION;

-- ── 2. A vacina aplicada — a dosagem deixou de ser contagem inteira de doses ──
-- `quantidade` passa a ser o VALOR na forma de cálculo (5 mL, 2,5 mL, 1 dose).
-- `forma_calculo` é SNAPSHOT: a folha e a fatura de dois anos atrás precisam sair na
-- unidade daquele dia, mesmo que o cadastro do produto mude depois.
ALTER TABLE "schs2vet"."tb_vacinas_clinicas"
  ALTER COLUMN "quantidade" TYPE DOUBLE PRECISION;

ALTER TABLE "schs2vet"."tb_vacinas_clinicas"
  ADD COLUMN IF NOT EXISTS "forma_calculo" VARCHAR(20);

-- ── 3. Estoque de vacina e reservas acompanham a mesma unidade ───────────────
-- Sem isto o lote continuaria contando em inteiros enquanto a aplicação sai em mL, e
-- a diferença apareceria como saldo que não fecha.
ALTER TABLE "schs2vet"."tb_reservas_estoque_vacina"
  ALTER COLUMN "quantidade" TYPE DOUBLE PRECISION;

ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ALTER COLUMN "qtd_total" TYPE DOUBLE PRECISION;
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ALTER COLUMN "qtd_disponivel" TYPE DOUBLE PRECISION;
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ALTER COLUMN "doses_por_frasco" TYPE DOUBLE PRECISION;
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ALTER COLUMN "estoque_minimo" TYPE DOUBLE PRECISION;
ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ALTER COLUMN "estoque_alarmante" TYPE DOUBLE PRECISION;
