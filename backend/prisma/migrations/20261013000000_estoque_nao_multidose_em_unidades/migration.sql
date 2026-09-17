-- 🔴 PRODUTO SEM MULTIDOSE PASSA A SER CONTADO EM UNIDADES (2026-09-17, a pedido).
--
-- A REGRA NOVA: sem multidose, a Forma de Cálculo é 'Un.' — a embalagem é a própria
-- unidade. Ela entra inteira no estoque (Qtd Total = Qtd Produto), a receita é escrita
-- em 'Un.' e a linha da fatura sai por `valor_repassado ÷ Qtd Produto`.
--
-- POR QUE ESTE BACKFILL EXISTE: antes da regra, a tela de estoque MULTIPLICAVA a Qtd
-- Produto por um conteúdo tirado do NOME do produto por heurística ("frasco 15 mL"),
-- gravava esse número em `peso_por_embalagem` e contava o saldo no CONTEÚDO — 2 frascos
-- viravam "30", com o preço em R$/mL. Com o estoque em 'Un.', essas linhas passariam a
-- ler "30 unidades" de um item que tem 2 frascos, e uma receita de 1 Un. cobraria
-- R$ 6,67 (o R$/mL gravado) em vez dos R$ 100 do frasco.
--
-- ⚠️ MEDIDO NESTA BASE (2026-09-17): 6 entradas ATIVAS de produto não-multidose, das
-- quais **3** estão nesse estado (`peso_por_embalagem` preenchido) — Imizol 15 mL,
-- NGF-5 20 g e Equimax 30 g. As outras 3 já contam embalagens e NÃO são tocadas
-- (o WHERE as exclui). Nenhuma linha de produto MULTIDOSE entra aqui: ali o conteúdo é
-- declarado no cadastro e o saldo em mL/g está correto.
--
-- ⚠️ SÓ AS ENTRADAS ATIVAS. A inativa é histórico na unidade antiga — mesma decisão de
-- `reapontarParaCopia` (lib/unidadeMedicamento.js), que também não a arrasta. Se uma
-- delas for reativada, a Qtd Produto precisa ser reinformada na tela.
--
-- ⚠️ `tb_movimentos_estoque` NÃO é reescrito: ele registra o que aconteceu, na unidade
-- em que aconteceu. Adulterá-lo trocaria um saldo errado por um histórico falso.
--
-- ⚠️ `set_config('app.plataforma')` é OBRIGATÓRIO: `tb_estoque_clinica` está com RLS
-- ENABLE + FORCE e a policy vale até para o DONO do schema, que é quem roda as
-- migrations. Sem o carimbo o UPDATE afeta ZERO linhas — com sucesso e sem aviso
-- (armadilha 42 do CLAUDE.md). `true` = LOCAL à transação, para o carimbo não vazar
-- para a conexão seguinte do pool.

SELECT set_config('app.plataforma', 'on', true);

-- ── 1. Saldo, mínimos e preço passam para EMBALAGENS ─────────────────────────
-- A divisão preserva a FRAÇÃO de propósito: 98 g de bisnagas de 20 g são 4,9 bisnagas,
-- e arredondar inventaria (ou apagaria) meia embalagem no saldo da clínica.
UPDATE "schs2vet"."tb_estoque_clinica" e
   SET "qtdEstoque"       = e."qtdEstoque"       / e."peso_por_embalagem",
       "estoqueMinimo"    = e."estoqueMinimo"    / e."peso_por_embalagem",
       "estoqueAlarmante" = e."estoqueAlarmante" / e."peso_por_embalagem",
       -- O preço é `valor_repassado ÷ Qtd Produto` — o total COMPRADO, nunca o saldo
       -- restante: dividir pelo que sobrou faz o preço unitário SUBIR a cada dose
       -- aplicada (o defeito do caminho legado de `precoUnitarioDoEstoque`).
       "preco_unitario_base" = CASE
         WHEN e."qtd_embalagens" IS NOT NULL AND e."qtd_embalagens" > 0
           THEN e."valor_repassado" / e."qtd_embalagens"
         ELSE e."valor_repassado" / NULLIF(e."qtdEstoque" / e."peso_por_embalagem", 0)
       END,
       -- Zera o conteúdo: é ele que marca a linha como "contada por dentro", e deixá-lo
       -- faria a calculadora da tela multiplicar de novo na próxima edição.
       "peso_por_embalagem" = NULL,
       "updatedAt" = NOW() AT TIME ZONE 'UTC'
  FROM "schs2vet"."tb_medicamentos" m
 WHERE m."id" = e."medicamentoId"
   AND e."ativo" = true
   AND COALESCE(m."multidose", false) = false
   AND e."peso_por_embalagem" IS NOT NULL
   AND e."peso_por_embalagem" > 0;
