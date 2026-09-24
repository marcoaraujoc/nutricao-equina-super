-- 🔴 ENCAMINHAR PARA O PRESTADOR DO CADASTRO, TENHA ELE LOGIN OU NÃO (2026-09-23).
--
-- POR QUÊ: o destino interno do encaminhamento só podia ser um USUÁRIO
-- (`prestador_id` → `users`), e prestador só ganha usuário quando o cadastro é
-- salvo com "acesso ao sistema" (ver `PrestadorController` → `provisionarLogin`).
-- O ferrador, o quiroprata e o fisioterapeuta que a clínica cadastrou SEM login
-- simplesmente não existiam no seletor de destino — e a aba, que se chamava
-- "Prestador da equipe", listava no lugar deles os VETERINÁRIOS da equipe.
--
-- COMO: o encaminhamento passa a guardar também o CADASTRO de origem, no par
-- (origem, id) que este schema já usa em conta a pagar — `tb_prestadores` e
-- `tb_fornecedores` são tabelas distintas e uma FK única não alcançaria as duas.
--   prestador_cadastro_origem  'PRESTADOR' | 'FORNECEDOR'
--   prestador_cadastro_id      id na tabela daquela origem
--
-- ⚠️ FORNECEDOR entra junto de propósito: `PRESTADOR` nasceu em 2026-09-09 e NADA
-- foi migrado (CLAUDE.md, §4) — quem já estava cadastrado como prestador externo
-- segue em `tb_fornecedores`. Ler só `tb_prestadores` sumiria com a maior parte da
-- base.
--
-- ⚠️ `prestador_id` CONTINUA e continua sendo quem recebe a `DesignacaoPrestador`:
-- designação é ESCOPO DE ACESSO, e não há a quem dar acesso quando não existe login.
-- Encaminhar para prestador sem login grava o registro clínico e NÃO libera o
-- paciente — a tela diz isso antes de salvar.
--
-- ⚠️ SEM FK, mesmo precedente de `fechado_por_id`/`pago_por_id`: o par (origem, id)
-- não é endereçável por uma FK só, e o cadastro é soft-deleted (`ativo`), então a
-- linha de origem não desaparece. A leitura resolve o nome e cai em "—".
--
-- ⚠️ ADITIVA e SEM BACKFILL: encaminhamento existente nasce com as duas colunas
-- NULAS e segue sendo lido por `prestador_id`, exatamente como hoje.

ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "prestador_cadastro_id"     INTEGER,
  ADD COLUMN IF NOT EXISTS "prestador_cadastro_origem" VARCHAR(12);

-- O recorte que a listagem faz: "quais encaminhamentos foram para este cadastro".
CREATE INDEX IF NOT EXISTS "tb_encaminhamentos_clinicos_prestador_cadastro_idx"
  ON "schs2vet"."tb_encaminhamentos_clinicos" ("prestador_cadastro_origem", "prestador_cadastro_id");

-- Origem só aceita os dois valores que existem — VARCHAR livre deixaria um terceiro
-- rótulo entrar e nunca casar com nada na leitura, em silêncio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tb_encaminhamentos_clinicos_prestador_cadastro_origem_check'
  ) THEN
    ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos"
      ADD CONSTRAINT "tb_encaminhamentos_clinicos_prestador_cadastro_origem_check"
      CHECK ("prestador_cadastro_origem" IS NULL
             OR "prestador_cadastro_origem" IN ('PRESTADOR', 'FORNECEDOR'));
  END IF;
END $$;
