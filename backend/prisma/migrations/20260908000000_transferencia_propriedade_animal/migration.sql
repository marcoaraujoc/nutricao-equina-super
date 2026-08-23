-- ════════════════════════════════════════════════════════════════════════════
-- Transferência de Propriedade do animal.
-- ⚠️ Esta migration também criava as colunas `resp_financeiro_*` ("Responsável
-- Financeiro" do animal) — feature REMOVIDA depois; ver a migration
-- `20260909000000_remove_responsavel_financeiro_animal`, que as derruba.
--
-- 🔴 GERADA, NÃO APLICADA — confirmar com o usuário antes de
--    DATABASE_URL=$DATABASE_URL_MIGRATIONS npx prisma migrate deploy
--    (o usuário padrão do app não tem CREATE/ALTER no schema — CLAUDE.md §11).
--    Depois de aplicada: rodar `npx prisma generate` e SÓ ENTÃO adicionar
--    "tb_animal_proprietario_historico" a TENANT_PLANE em
--    backend/src/__tests__/tenancyRls.test.js — o gate só reconhece tabela que
--    existe de verdade; listá-la ANTES reprovaria o teste "cita tabela
--    inexistente" (mesmo cuidado já registrado para tb_reservas_estoque_vacina).
--
-- `tb_animal_proprietario_historico` — uma linha por JANELA de posse contínua do
-- animal. A janela ABERTA (data_fim IS NULL) é sempre o dono ATUAL; é o que a
-- Transferência de Propriedade fecha (grava motivo_transferencia) ao mesmo tempo
-- que abre a próxima. `tb_animais.propriedade_desde` é uma CÓPIA da data_inicio da
-- janela aberta — só para não repetir esta consulta em toda tela que precisa saber
-- "desde quando o dono atual é dono"; a tabela de histórico é que serve de fonte
-- de verdade para a exportação por um dono ANTERIOR (janela fechada, [inicio,fim)).
--
-- ⚠️ BACKFILL OBRIGATÓRIO — sem ele, todo animal já cadastrado nasceria SEM
-- janela aberta (a Exportação quebraria para a base inteira) e propriedade_desde
-- esconderia o histórico inteiro de todo proprietário existente (o DEFAULT
-- now() só vale para linha NOVA, não para as já cadastradas).
-- ════════════════════════════════════════════════════════════════════════════

-- tb_animais — novas colunas
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "propriedade_desde"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "resp_financeiro_proprio"  BOOLEAN      NOT NULL DEFAULT true;
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "resp_financeiro_nome"     VARCHAR(255);
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "resp_financeiro_email"    VARCHAR(255);
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "resp_financeiro_telefone" VARCHAR(30);

-- Backfill: todo animal já existente "é dono desde o cadastro", não desde agora.
UPDATE "schs2vet"."tb_animais" SET "propriedade_desde" = "dataCadastro";

-- tb_animal_proprietario_historico
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_animal_proprietario_historico" (
    "id"                   SERIAL       NOT NULL,
    "animal_id"            INTEGER      NOT NULL,
    "proprietario_id"      INTEGER      NOT NULL,
    "data_inicio"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_fim"             TIMESTAMP(3),
    "motivo_transferencia" VARCHAR(20),
    "empresa_id"           INTEGER      NOT NULL,
    "criado_por_id"        INTEGER,

    CONSTRAINT "tb_animal_proprietario_historico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_animal_proprietario_historico_animal_id_data_fim_idx" ON "schs2vet"."tb_animal_proprietario_historico"("animal_id", "data_fim");
CREATE INDEX IF NOT EXISTS "tb_animal_proprietario_historico_proprietario_id_idx"    ON "schs2vet"."tb_animal_proprietario_historico"("proprietario_id");

ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" ADD CONSTRAINT "tb_animal_proprietario_historico_animal_id_fkey"       FOREIGN KEY ("animal_id")       REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" ADD CONSTRAINT "tb_animal_proprietario_historico_proprietario_id_fkey" FOREIGN KEY ("proprietario_id") REFERENCES "schs2vet"."users"("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" ADD CONSTRAINT "tb_animal_proprietario_historico_empresa_id_fkey"      FOREIGN KEY ("empresa_id")      REFERENCES "schs2vet"."tb_empresas"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" ADD CONSTRAINT "tb_animal_proprietario_historico_criado_por_id_fkey"   FOREIGN KEY ("criado_por_id")   REFERENCES "schs2vet"."users"("id")      ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: uma janela ABERTA por animal já existente, começando no cadastro dele.
INSERT INTO "schs2vet"."tb_animal_proprietario_historico"
  ("animal_id", "proprietario_id", "data_inicio", "data_fim", "empresa_id", "criado_por_id")
SELECT "id", "userId", "dataCadastro", NULL, "empresaId", NULL
FROM "schs2vet"."tb_animais";

-- tb_animal_proprietario_historico — TENANT DIRETO (empresa_id na própria linha,
-- mesmo padrão de tb_prestadores/tb_fornecedores)
ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_animal_proprietario_historico" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_animal_proprietario_historico" ON "schs2vet"."tb_animal_proprietario_historico";
CREATE POLICY "tenant_tb_animal_proprietario_historico" ON "schs2vet"."tb_animal_proprietario_historico"
  USING ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_plataforma"() OR ("empresa_id" = "schs2vet"."app_empresa_id"()));
