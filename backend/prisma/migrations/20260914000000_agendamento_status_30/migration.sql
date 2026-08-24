-- Alarga `tb_agendamentos_clinicos.status` de VARCHAR(20) para VARCHAR(30).
--
-- 🔴 BUG EM PRODUÇÃO, NÃO MELHORIA. O status `CANCELADO_AUTOMATICAMENTE` (25 caracteres,
-- criado em 2026-08-18) NÃO CABE na coluna de 20. É o único valor que a rotina noturna
-- `cancelar_agendamentos_nao_realizados` grava — então, desde que ele existe, aquele job
-- falha TODA NOITE, em toda empresa que tenha algum agendamento a encerrar:
--
--   Invalid `db.agendamentoClinico.updateMany()` invocation
--   The provided value for the column is too long for the column's type.
--
-- Como o cron roda dentro de uma transação por empresa (`paraCadaEmpresa`), o erro
-- derruba o LOTE INTEIRO daquela clínica ("LOTE REVERTIDO (rollback)" na Monitoração) e
-- NENHUM agendamento é encerrado — nem os do ramo que teria funcionado. O efeito visível
-- é agendamento preso em AGENDADO/EM_ANDAMENTO indefinidamente, ocupando a grade.
--
-- Os demais valores cabem com folga: AGENDADO(8), EM_ANDAMENTO(12), CONCLUIDO(9),
-- FINALIZADO(10), CANCELADO(9), REAGENDADO(10), TRANSFERIDO(11), ATRASADA(8).
-- 30 dá margem para um valor futuro sem repetir o episódio.
--
-- Sem risco de perda: alargar VARCHAR no Postgres não reescreve a tabela nem toca em
-- dado existente. Não há backfill a fazer — o valor nunca chegou a ser gravado.

ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ALTER COLUMN "status" TYPE VARCHAR(30);
