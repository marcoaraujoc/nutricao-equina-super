-- ════════════════════════════════════════════════════════════════════════════
-- CONTROLE DE CONCORRÊNCIA DE EDIÇÃO — evolução e agendamento (2026-09-05)
--
-- POR QUÊ: até aqui "quem salva por último vence". Dois profissionais no MESMO
-- registro sobrescrevem um ao outro em silêncio, e nada no sistema acusa — o texto
-- do primeiro simplesmente deixa de existir. Em prontuário isso é perda de dado
-- clínico, não um detalhe de UX.
--
-- A autoria (`podeOperarRegistro`) NÃO resolve isso: ela responde "posso operar o
-- registro DESTA pessoa?", e é verdadeira para os DOIS gestores da mesma clínica
-- editando a mesma evolução. Autoria é AUTORIZAÇÃO; concorrência é INTEGRIDADE.
--
-- ── 1. `versao` — TRAVA OTIMISTA ────────────────────────────────────────────
-- Cada escrita bem-sucedida incrementa. Quem salva manda a versão que LEU, e o
-- UPDATE é condicionado a ela (`WHERE id = $1 AND versao = $2`): se outra pessoa
-- gravou no meio, `count = 0` e a resposta é 409 — nunca um overwrite calado.
--
-- ⚠️ Vale MESMO SEM tempo real. Navegador offline, aba congelada, evento SSE
-- perdido, conexão instável: o banco recusa igual, porque a garantia está na
-- cláusula WHERE e não no aviso que a tela recebeu.
--
-- DEFAULT 1 (e NOT NULL) porque a coluna precisa ter valor no registro que já
-- existe: linha legada nasce na versão 1 e entra no ciclo na primeira edição.
--
-- ── 2. `autor_id` — QUEM CRIOU, separado de QUEM EDITA ───────────────────────
-- `veterinarioId` é hoje as DUAS coisas ao mesmo tempo, e `assumir` o sobrescreve.
-- Ou seja: assumir a evolução APAGA quem a criou, e o prontuário perde a resposta
-- de "quem abriu este atendimento?" — que é justamente o que a auditoria clínica
-- precisa preservar.
--
-- ⚠️ `veterinarioId` NÃO muda de significado: ele continua sendo o EDITOR/RESPONSÁVEL
-- atual, que é o que os ~47 pontos que o leem já esperam (escopo, autoria, agenda).
-- A coluna nova só acrescenta o que se perdia. Backfill = `veterinarioId`, que no
-- registro existente ainda é o criador em todo caso que nunca foi assumido; nos
-- assumidos, o dado original já não existe e adivinhá-lo seria inventar autoria.
--
-- ── O QUE NÃO ENTROU, DE PROPÓSITO ──────────────────────────────────────────
-- Não há coluna `editando_por` / `editando_desde` / lock com TIMEOUT. Lock com
-- expiração exige heartbeat, e heartbeat que falha por rede instável libera o
-- registro de quem AINDA está digitando — troca um problema raro (dois editando)
-- por um pior (o lock some sozinho no meio do atendimento). Quem exerce a
-- exclusividade aqui é o par `veterinarioId` (autorização) + `versao`
-- (integridade), e "assumir" é a transferência EXPLÍCITA, feita por uma pessoa.
--
-- Sem RLS novo: as duas tabelas já estão no tenant plane e já têm policy própria.
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠️ `"versao"` sem `@map` no schema → coluna em camelCase? NÃO: o nome é todo
-- minúsculo e sem underscore, então não há diferença entre a forma citada e a
-- dobrada pelo Postgres. As aspas ficam por consistência com o resto do arquivo.
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"
  ADD COLUMN IF NOT EXISTS "versao" INTEGER NOT NULL DEFAULT 1;

-- ⚠️ `autor_id` é SEM FK, igual a `assumido_de_id` (migration 20260815000000): o
-- registro clínico sobrevive à exclusão do usuário. Com `SetNull` numa FK, excluir
-- a conta do profissional APAGARIA a autoria do prontuário dele — exatamente o que
-- esta coluna existe para preservar.
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas"
  ADD COLUMN IF NOT EXISTS "autor_id" INTEGER;

ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "versao" INTEGER NOT NULL DEFAULT 1;

-- ── Backfill da autoria ─────────────────────────────────────────────────────
-- Só onde ainda está nulo (idempotente) e só a partir do responsável atual — não
-- se tenta reconstruir autoria de evolução já assumida a partir do AuditLog:
-- a trilha existe e é consultável, mas transformá-la em coluna faria o sistema
-- AFIRMAR uma autoria que ele derivou por heurística.
--
-- 🔴 EM ESCOPO DE PLATAFORMA, E ISTO NÃO É OPCIONAL. `tb_evolucoes_clinicas` está
-- com RLS e **FORCE ROW LEVEL SECURITY**, e a policy é fail-closed:
--     app_plataforma() OR empresa_id = app_empresa_id()
-- O usuário de migration é DONO da tabela mas não tem BYPASSRLS — com FORCE, nem o
-- dono escapa. Sem carimbar o escopo, este UPDATE enxerga ZERO LINHA e não falha:
-- a migration "passa", a coluna nasce toda NULA e ninguém descobre até alguém
-- perguntar quem criou um atendimento antigo. (Medido nesta base: 0 linhas visíveis
-- contra ~26 reais.) É a mesma armadilha do re-seed do catálogo global — CLAUDE.md.
--
-- `set_config(..., true)` = LOCAL: vale só nesta transação e reverte ao fim, então
-- a sessão não fica com escopo de plataforma pendurado depois da migration.
DO $backfill$
DECLARE
  afetadas integer;
BEGIN
  PERFORM set_config('app.plataforma', 'on', true);

  UPDATE "schs2vet"."tb_evolucoes_clinicas"
     SET "autor_id" = "veterinarioId"
   WHERE "autor_id" IS NULL AND "veterinarioId" IS NOT NULL;

  GET DIAGNOSTICS afetadas = ROW_COUNT;
  -- Deixa rastro no log da migration: backfill silencioso é justamente o que se
  -- quer evitar aqui.
  RAISE NOTICE 'backfill autor_id: % evolucoes', afetadas;
END
$backfill$;

CREATE INDEX IF NOT EXISTS "tb_evolucoes_clinicas_autor_id_idx"
  ON "schs2vet"."tb_evolucoes_clinicas" ("autor_id");
