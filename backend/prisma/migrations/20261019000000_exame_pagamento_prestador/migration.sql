-- ════════════════════════════════════════════════════════════════════════════
-- EXAME LANÇADO NO PAGAMENTO AO PRESTADOR (2026-09-22)
--
-- 🔴 O QUE ESTA MIGRATION RESOLVE: o exame executado por um prestador externo era
-- COBRADO do cliente e não chegava à tela de Pagamentos. O procedimento fazia as
-- duas metades desde 2026-09-10 (`PrescricaoGrupoController.executar` grava o ledger
-- do recibo E abre/alimenta a conta a pagar do prestador); o exame só tinha a
-- primeira metade escrita — e, na prática, nem essa: `registrarReciboDoExame` só
-- rodava em `PATCH /clinica/exames/:id/finalizar`, rota que NENHUMA tela chama. A
-- conclusão de verdade é `salvarResultado` (status REALIZADO), e ali não havia nada.
--
-- Uma coluna e um índice, ADITIVOS. Nenhum UPDATE/DELETE, nenhum backfill: exame
-- concluído antes desta migration não ganha prestador por dedução (o `veterinario_id`
-- do exame é quem PEDIU, não quem executou), exatamente como a migration
-- `20261001000000` decidiu para o procedimento. O pagamento passa a valer daqui em
-- diante.
--
-- ⚠️ SEM `prisma generate` obrigatório: a coluna é lida e gravada por SQL cru em
-- `lib/procedimentoPrestador.js` (§11 — no Windows o generate falha com o backend no ar).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Origem do ledger: o EXAME, ao lado da prescrição ────────────────────────
--
-- ⚠️ SEM FK, pela MESMA razão de `prescricao_id` (migration 20261001000000): o
-- recibo tem de sobreviver ao cancelamento do exame que o originou — o serviço foi
-- prestado, e o que se faz com a cobrança do cliente é outra decisão.
--
-- ⚠️ É uma coluna NOVA e não o reuso de `prescricao_id`: as duas origens convivem na
-- mesma tabela e guardar as duas no mesmo campo tornaria impossível dizer se o id 47
-- é a prescrição 47 ou o exame 47 — e o recibo aponta para o registro errado.
ALTER TABLE "schs2vet"."tb_execucoes_procedimento_prestador"
  ADD COLUMN IF NOT EXISTS "exame_clinico_id" INTEGER;

-- 🔴 IDEMPOTÊNCIA: UMA linha de ledger por EXAME.
--
-- O procedimento se protegia pela construção do fluxo ("executar" só roda uma vez
-- por dose). O exame não tem essa garantia: `salvarResultado` é REENVIÁVEL — a
-- pessoa recarrega o laudo porque a IA falhou, ou corrige a tabela digitada —, e
-- sem o índice cada reenvio somaria outra dívida ao prestador, calada.
--
-- ⚠️ Índice PARCIAL: toda linha de PROCEDIMENTO tem `exame_clinico_id` nulo, e um
-- unique comum trataria os nulos como distintos em Postgres (funciona), mas o
-- parcial deixa explícito que a regra é só da origem EXAME e mantém o índice pequeno.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_execucoes_proc_prestador_exame_unico"
  ON "schs2vet"."tb_execucoes_procedimento_prestador" ("exame_clinico_id")
  WHERE "exame_clinico_id" IS NOT NULL;

-- ⚠️ RLS: nada a fazer. `tb_execucoes_procedimento_prestador` já está com
-- ENABLE + FORCE ROW LEVEL SECURITY e a policy de tenant direto desde a migration
-- 20261001000000, e esta migration não faz DML nenhum — logo não precisa carimbar
-- `app.plataforma` (armadilha 42).
