-- 🔴 VALOR COMPRADO E VALOR REPASSADO PASSAM A SER POR EMBALAGEM (2026-09-17, a pedido:
-- "no estoque não multiplique o Valor Comprado e Valor Repassado pela quantidade; isso
-- mexe diretamente no cálculo da fatura").
--
-- O QUE MUDOU NO CÓDIGO: a tela de Farmácia multiplicava os dois valores pela Qtd
-- Produto antes de gravar, e `calcPrecoUnitarioBase` dividia pelo SALDO inteiro. As duas
-- operações se cancelavam e o preço da dose saía certo — mas o banco ficava com o TOTAL
-- da compra em campos rotulados "Valor Unitário", e quem lia o campo cru cobrava a
-- compra inteira numa linha só: `debitarInsumoUnidade` cobrava a CAIXA de seringas por
-- UMA seringa, e reabrir a entrada trazia o total para um campo unitário (que, salvo de
-- novo, era multiplicado outra vez). Agora o valor gravado é o de UMA embalagem e quem
-- divide o preço é o CONTEÚDO dela — o mesmo modelo que a vacina já usa
-- (`tb_lotes_vacina.valor_unitario_repassado` ÷ `doses_por_frasco`).
--
-- ⚠️ ESTE BACKFILL NÃO MUDA A COBRANÇA DE NADA. `preco_unitario_base` — o número que vai
-- para a linha da fatura — NÃO é tocado: ele já é R$/unidade base e continua exatamente
-- o mesmo. O que se reexpressa é só a UNIDADE em que `valor`/`valor_repassado` estão
-- escritos. Conferido nas 9 linhas desta base (2026-09-17): `valor_repassado ÷
-- qtd_embalagens` reproduz o `preco_unitario_base` gravado em TODAS elas, inclusive na
-- multidose (id 39: 100 ÷ 1 ÷ 20 mL = R$ 5,00/mL) e nas inativas.
--
-- ⚠️ `qtd_embalagens` NULO OU 1 FICA INTOCADO, e não é descuido: nessas entradas a tela
-- já gravava `nPacotes = 1`, então o valor JÁ é o de uma embalagem. Dividir de novo
-- deixaria o campo menor que o preço que a fatura cobra.
--
-- ⚠️ AS INATIVAS ENTRAM, ao contrário do backfill de 20261013000000. Lá o que mudava era
-- o SALDO, e o histórico da entrada encerrada tinha de ser preservado na unidade em que
-- aconteceu. Aqui muda o SIGNIFICADO de uma coluna: deixar a inativa com o total faria a
-- tela exibir o valor errado e, ao reativá-la e salvar, recalcular o preço errado.
--
-- ⚠️ `tb_movimentos_estoque` NÃO é tocado — ele registra quantidades, não valores.
--
-- ⚠️ `set_config('app.plataforma')` é OBRIGATÓRIO: `tb_estoque_clinica` está com RLS
-- ENABLE + FORCE e a policy vale até para o DONO do schema, que é quem roda as
-- migrations. Sem o carimbo o UPDATE afeta ZERO linhas — com sucesso e sem aviso
-- (armadilha 42 do CLAUDE.md). `true` = LOCAL à transação, para o carimbo não vazar
-- para a conexão seguinte do pool.

SELECT set_config('app.plataforma', 'on', true);

-- ── Valor TOTAL da compra → valor de UMA embalagem ───────────────────────────
-- A divisão preserva a FRAÇÃO: 6 embalagens por R$ 500 são R$ 83,333… cada, e arredondar
-- faria o valor exibido discordar do preço que já está congelado em
-- `preco_unitario_base`.
UPDATE "schs2vet"."tb_estoque_clinica"
   SET "valor"           = "valor"           / "qtd_embalagens",
       "valor_repassado" = "valor_repassado" / "qtd_embalagens",
       "updatedAt"       = NOW() AT TIME ZONE 'UTC'
 WHERE "qtd_embalagens" IS NOT NULL
   AND "qtd_embalagens" > 1;
