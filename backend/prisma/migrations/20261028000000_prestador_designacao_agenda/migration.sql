-- ════════════════════════════════════════════════════════════════════════════
-- PRESTADOR SEM LOGIN: AUTORIZAÇÃO POR CADASTRO + AGENDA (2026-09-30)
--
-- 🔴 O QUE ESTA MIGRATION RESOLVE: a designação de pacientes ("Gerenciar Acesso") e
-- o agendamento eram gravados pelo LOGIN do profissional (`tb_designacoes_prestador.
-- prestador_id` e `tb_agendamentos_clinicos.veterinario_id` apontam para `users`).
-- O prestador cadastrado SEM "Terá acesso ao sistema" não tem login — logo não havia
-- onde gravar a autorização nem a quem atribuir o agendamento. Na tela, o botão
-- "Gerenciar Acesso" simplesmente não aparecia para ele.
--
-- Decisão (2026-09-30, a pedido): o prestador SEM login também pode receber a
-- autorização de pacientes e ser agendado para eles. Dois objetos, ADITIVOS:
--
-- 1. `tb_designacoes_prestador_cadastro` — a autorização pelo CADASTRO
--    (tb_prestadores.id), não pelo usuário.
--    ⚠️ TABELA NOVA, e não uma coluna em `tb_designacoes_prestador`: aquela tem
--    `prestador_id NOT NULL` apontando para `users`, é lida por ~10 pontos pelo
--    client Prisma TIPADO e governa o ESCOPO DE ACESSO do login (animalScope,
--    animalAccess). Torná-la nulável quebraria esses leitores em silêncio enquanto o
--    client estiver defasado. A designação por LOGIN continua sendo a que dá acesso
--    ao sistema; esta é a que autoriza o paciente para o CADASTRO — quando o
--    prestador tem login, a tela grava as DUAS (espelho), e quando o login nasce
--    depois, as desta tabela são copiadas para a outra (`lib/designacaoPrestadorCadastro.js`).
--
-- 2. `tb_agendamentos_clinicos.prestador_cadastro_id` — o agendamento pode ter como
--    responsável um PRESTADOR (cadastro). `veterinario_id` continua sendo o LOGIN:
--    prestador com login grava os dois; sem login, só este.
--    ⚠️ `ON DELETE SET NULL`: o prestador é inativado (soft delete), nunca apagado —
--    o SET NULL só cobre a exclusão física, e não leva o agendamento junto.
--
-- Sem backfill: autorização e agendamento por cadastro valem daqui em diante. As
-- designações por LOGIN já existentes continuam valendo e são lidas junto (união).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Autorização por cadastro ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_designacoes_prestador_cadastro" (
  "id"            SERIAL       PRIMARY KEY,
  "empresa_id"    INTEGER      NOT NULL,
  "prestador_id"  INTEGER      NOT NULL,
  "animal_id"     INTEGER      NOT NULL,
  "motivo"        VARCHAR(255),
  "ativo"         BOOLEAN      NOT NULL DEFAULT true,
  "data_inicio"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "data_fim"      TIMESTAMP(3),
  "criado_por_id" INTEGER,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- UMA linha por (prestador, animal): conceder de novo REATIVA a linha (ativo=true,
-- data_fim=null), revogar a INATIVA — o histórico fica, como em tb_designacoes_prestador.
CREATE UNIQUE INDEX IF NOT EXISTS "tb_designacoes_prestador_cadastro_unico"
  ON "schs2vet"."tb_designacoes_prestador_cadastro" ("prestador_id", "animal_id");

CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_cadastro_empresa_id_idx"
  ON "schs2vet"."tb_designacoes_prestador_cadastro" ("empresa_id");
CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_cadastro_animal_id_idx"
  ON "schs2vet"."tb_designacoes_prestador_cadastro" ("animal_id");
CREATE INDEX IF NOT EXISTS "tb_designacoes_prestador_cadastro_prestador_ativo_idx"
  ON "schs2vet"."tb_designacoes_prestador_cadastro" ("prestador_id", "ativo");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_designacoes_prestador_cadastro"
    ADD CONSTRAINT "tb_designacoes_prestador_cadastro_empresa_id_fkey"
    FOREIGN KEY ("empresa_id") REFERENCES "schs2vet"."tb_empresas"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_designacoes_prestador_cadastro"
    ADD CONSTRAINT "tb_designacoes_prestador_cadastro_prestador_id_fkey"
    FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."tb_prestadores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_designacoes_prestador_cadastro"
    ADD CONSTRAINT "tb_designacoes_prestador_cadastro_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- RLS — TENANT DIRETO, fail-closed (fase 7c): sem `app_empresa_id()` carimbado nada
-- passa, exceto o ADMIN da plataforma. Mesma forma de tb_procedimento_prestadores.
-- ⚠️ FORCE vale até para o dono do schema (armadilha 42).
-- 🔴 WITH CHECK MAIS FORTE QUE O USING (revisão multi-tenant de 2026-09-30): a FK
-- NÃO passa por RLS, então só `empresa_id = tenant` aceitaria uma linha da empresa A
-- apontando para o PACIENTE ou o PRESTADOR da empresa B (id forjado + bug no filtro do
-- controller). A escrita exige que os dois sejam da MESMA empresa da linha. Os EXISTS
-- rodam sob o RLS de tb_animais/tb_prestadores — sob o tenant A, a linha de B nem existe.
ALTER TABLE "schs2vet"."tb_designacoes_prestador_cadastro" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_designacoes_prestador_cadastro" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_designacoes_prestador_cadastro" ON "schs2vet"."tb_designacoes_prestador_cadastro";
CREATE POLICY "tenant_tb_designacoes_prestador_cadastro" ON "schs2vet"."tb_designacoes_prestador_cadastro"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK (
    "schs2vet"."app_plataforma"() OR (
      "empresa_id" = "schs2vet"."app_empresa_id"()
      AND EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" a
                   WHERE a."id" = "tb_designacoes_prestador_cadastro"."animal_id"
                     AND a."empresaId" = "tb_designacoes_prestador_cadastro"."empresa_id")
      AND EXISTS (SELECT 1 FROM "schs2vet"."tb_prestadores" p
                   WHERE p."id" = "tb_designacoes_prestador_cadastro"."prestador_id"
                     AND p."empresa_id" = "tb_designacoes_prestador_cadastro"."empresa_id")
    )
  );

-- ── 2. Prestador responsável pelo agendamento ───────────────────────────────

ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "prestador_cadastro_id" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_prestador_cadastro_idx"
  ON "schs2vet"."tb_agendamentos_clinicos" ("prestador_cadastro_id", "data_hora");

DO $do$ BEGIN
  ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
    ADD CONSTRAINT "tb_agendamentos_clinicos_prestador_cadastro_id_fkey"
    FOREIGN KEY ("prestador_cadastro_id") REFERENCES "schs2vet"."tb_prestadores"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
