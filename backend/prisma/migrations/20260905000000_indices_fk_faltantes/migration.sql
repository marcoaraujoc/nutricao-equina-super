-- Índices em colunas de FK sem cobertura nenhuma (nem simples, nem como coluna
-- líder de composto/unique) — levantamento feito direto no catálogo do Postgres
-- (pg_constraint/pg_index) em 2026-08-22. Sem isso, toda consulta que filtra/junta
-- por essas colunas faz sequential scan — indolor hoje com as tabelas praticamente
-- vazias, mas são justamente as tabelas clínicas/financeiras que crescem sem parar.
--
-- Alguns destes já estavam declarados no schema.prisma (ex.: ExameClinico.animalId)
-- sem nunca terem virado migration — dessincronia entre schema e histórico, não
-- falta de intenção. Todos abaixo, aplicados ou não antes, ficam cobertos aqui.
--
-- IF NOT EXISTS: idempotente, mesmo padrão já usado em
-- 20260730000000_exame_clinico_resultado_itens e 20260819000000_animal_historico.

-- Autoria (veterinarioId) — "evolução própria já aberta", listarResponsaveis,
-- podeOperarRegistro e afins filtram/agrupam por esta coluna o tempo todo.
CREATE INDEX IF NOT EXISTS "tb_evolucoes_clinicas_veterinarioId_idx"
  ON "schs2vet"."tb_evolucoes_clinicas"("veterinarioId");

-- INCLUDE_PADRAO do EvolucaoController traz `midias` em toda leitura de evolução
-- (listar, obter, criar, atualizar) — sem índice, é seq scan a cada carga de tela.
CREATE INDEX IF NOT EXISTS "tb_evolucao_midias_evolucaoId_idx"
  ON "schs2vet"."tb_evolucao_midias"("evolucaoId");

-- Listagem de exames/encaminhamentos "por animal" — o filtro mais óbvio dos dois
-- módulos, faltando mesmo assim.
CREATE INDEX IF NOT EXISTS "tb_exames_clinicos_animalId_idx"
  ON "schs2vet"."tb_exames_clinicos"("animalId");
CREATE INDEX IF NOT EXISTS "tb_exames_clinicos_veterinarioId_idx"
  ON "schs2vet"."tb_exames_clinicos"("veterinarioId");
CREATE INDEX IF NOT EXISTS "tb_encaminhamentos_clinicos_animalId_idx"
  ON "schs2vet"."tb_encaminhamentos_clinicos"("animalId");
CREATE INDEX IF NOT EXISTS "tb_encaminhamentos_clinicos_veterinarioId_idx"
  ON "schs2vet"."tb_encaminhamentos_clinicos"("veterinarioId");

-- Agenda: "meus agendamentos" (veterinarioId OR criadoPorId), conflito de horário.
CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_veterinario_id_idx"
  ON "schs2vet"."tb_agendamentos_clinicos"("veterinario_id");
CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_criado_por_id_idx"
  ON "schs2vet"."tb_agendamentos_clinicos"("criado_por_id");

-- Vacina: autoria + baixa/estorno de lote por vacina.
CREATE INDEX IF NOT EXISTS "tb_vacinas_clinicas_veterinarioId_idx"
  ON "schs2vet"."tb_vacinas_clinicas"("veterinarioId");
CREATE INDEX IF NOT EXISTS "tb_vacinas_clinicas_lote_id_idx"
  ON "schs2vet"."tb_vacinas_clinicas"("lote_id");

-- Financeiro: abrir uma fatura busca os itens por faturaId — o lookup mais comum
-- da tela de Faturamento, sem índice nenhum até aqui.
CREATE INDEX IF NOT EXISTS "tb_fatura_itens_faturaId_idx"
  ON "schs2vet"."tb_fatura_itens"("faturaId");
CREATE INDEX IF NOT EXISTS "tb_fatura_itens_animalId_idx"
  ON "schs2vet"."tb_fatura_itens"("animalId");
CREATE INDEX IF NOT EXISTS "tb_faturas_animalId_idx"
  ON "schs2vet"."tb_faturas"("animalId");

-- Resolução de contexto/permissão (checkPermission e afins) roda em praticamente
-- toda requisição autenticada; só existia o unique (equipeId, userId), que não
-- serve pra buscar por userId sozinho.
CREATE INDEX IF NOT EXISTS "tb_membros_equipe_userId_idx"
  ON "schs2vet"."tb_membros_equipe"("userId");

-- Convites por equipe (ControleAcesso > Convites), dieta por plano, finalizar/
-- executar prescrição por quem fez.
CREATE INDEX IF NOT EXISTS "tb_convites_equipe_equipeId_idx"
  ON "schs2vet"."tb_convites_equipe"("equipeId");
CREATE INDEX IF NOT EXISTS "tb_dieta_planoDietaId_idx"
  ON "schs2vet"."tb_dieta"("planoDietaId");
CREATE INDEX IF NOT EXISTS "tb_prescricao_grupos_finalizadoPorId_idx"
  ON "schs2vet"."tb_prescricao_grupos"("finalizadoPorId");
CREATE INDEX IF NOT EXISTS "tb_prescricao_grupos_executadoPorId_idx"
  ON "schs2vet"."tb_prescricao_grupos"("executadoPorId");
