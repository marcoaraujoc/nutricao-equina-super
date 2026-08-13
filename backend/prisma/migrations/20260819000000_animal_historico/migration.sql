-- Histórico de PESO, LOCALIZAÇÃO e BAIA do animal — um snapshot por alteração,
-- gravado por AnimalController.criar/atualizar. Alimenta o gráfico de peso e a
-- linha do tempo de local/baia em AnimalDetail. Ver comentário do model em
-- schema.prisma.
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_animal_historico" (
    "id"             SERIAL       NOT NULL,
    "animal_id"      INTEGER      NOT NULL,
    "peso"           DOUBLE PRECISION,
    "localizacao_id" INTEGER,
    "local"          VARCHAR(255),
    "baia"           VARCHAR(100),
    "registrado_em"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_por_id"  INTEGER,

    CONSTRAINT "tb_animal_historico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_animal_historico_animal_id_registrado_em_idx"
    ON "schs2vet"."tb_animal_historico"("animal_id", "registrado_em");
CREATE INDEX IF NOT EXISTS "tb_animal_historico_localizacao_id_idx"
    ON "schs2vet"."tb_animal_historico"("localizacao_id");

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_animal_historico"
    ADD CONSTRAINT "tb_animal_historico_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_animal_historico"
    ADD CONSTRAINT "tb_animal_historico_localizacao_id_fkey"
    FOREIGN KEY ("localizacao_id") REFERENCES "schs2vet"."tb_localizacoes_animal"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_animal_historico"
    ADD CONSTRAINT "tb_animal_historico_criado_por_id_fkey"
    FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tb_animal_historico — TENANT VIA PAI (tb_animais), mesmo padrão de
-- tb_exames_clinicos (20260806180000_fase7_rls_geral): sem empresa_id próprio, o
-- isolamento é pela empresa do ANIMAL referenciado.
ALTER TABLE "schs2vet"."tb_animal_historico" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_animal_historico" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_animal_historico" ON "schs2vet"."tb_animal_historico";
CREATE POLICY "tenant_tb_animal_historico" ON "schs2vet"."tb_animal_historico"
  USING ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_animais" p0 WHERE p0."id" = "animal_id" AND p0."empresaId" = "schs2vet"."app_empresa_id"()));
