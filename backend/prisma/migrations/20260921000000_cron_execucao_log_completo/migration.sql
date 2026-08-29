-- ════════════════════════════════════════════════════════════════════════════
-- Log de execução das tarefas agendadas — TODA execução, não só a que fez trabalho
--
-- POR QUÊ: `reportarCron` gravava em `tb_cron_execucoes` apenas quando havia TRABALHO
-- ou ERRO (`relevante = !ok || notificar`). Consequência prática, medida nesta base: o
-- "Cancelamento de prescrições não executadas" tem registro em 22, 23 e 24/08 e nada
-- depois — e não havia como distinguir "rodou e não tinha o que fazer" de "não rodou
-- porque o servidor estava fora do ar às 23:40". Eram 7 prescrições com a janela
-- vencida esperando um cancelamento que ninguém sabia que não tinha acontecido.
-- Um log que só registra quando algo acontece não responde à única pergunta que
-- importa depois: "essa tarefa rodou?".
--
-- COLUNAS NOVAS
--   origem     AUTOMATICA (agenda do node-cron) | MANUAL (botão "Executar agora").
--              Sem ela, um teste manual e uma execução de produção ficam idênticos no
--              histórico — e o teste manual roda de verdade (grava, envia WhatsApp).
--   duracao_ms Quanto levou. É o que denuncia o job que passou a demorar demais antes
--              de ele começar a estourar timeout.
--
-- Ambas com DEFAULT/nulo para as ~centenas de linhas já existentes: nenhuma delas sabe
-- a própria origem, e AUTOMATICA é a suposição certa (o botão manual é recente).
--
-- ⚠️ `tb_cron_execucoes` é CONTROL PLANE (sem RLS, ver src/lib/tenancyMap.js): o job
-- varre TODAS as empresas e o histórico é da plataforma, não de uma clínica. Nada de
-- policy aqui.
--
-- EXPURGO: 15 dias, pelo job `expurgo_execucoes_cron` (server.ts). O índice em
-- `executadoEm` já existe e é o que o DELETE do expurgo usa.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_cron_execucoes"
  ADD COLUMN IF NOT EXISTS "origem" VARCHAR(12) NOT NULL DEFAULT 'AUTOMATICA';

ALTER TABLE "schs2vet"."tb_cron_execucoes"
  ADD COLUMN IF NOT EXISTS "duracaoMs" INTEGER;

COMMENT ON COLUMN "schs2vet"."tb_cron_execucoes"."origem" IS
  'AUTOMATICA = agenda do node-cron; MANUAL = botão "Executar agora" (tela de Configuração).';
COMMENT ON COLUMN "schs2vet"."tb_cron_execucoes"."duracaoMs" IS
  'Duração da execução em milissegundos. Nulo nas linhas anteriores à migration.';
