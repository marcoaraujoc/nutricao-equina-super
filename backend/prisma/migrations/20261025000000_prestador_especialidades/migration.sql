-- Prestador ↔ Especialidade (2026-09-29) — espelha tb_fornecedor_especialidades
-- (migration 20260717000000). É a fonte oficial de "que serviço este prestador
-- presta": Prestador.tipo_servico deixa de ser digitado e passa a ser DERIVADO
-- desta lista (ver PrestadorController#resolverEspecialidadesPrestador).
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_prestador_especialidades" (
  "id"               SERIAL PRIMARY KEY,
  "prestador_id"     INTEGER NOT NULL,
  "especialidade_id" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tb_prestador_especialidades_prestador_id_especialidade_id_key"
  ON "schs2vet"."tb_prestador_especialidades" ("prestador_id", "especialidade_id");
CREATE INDEX IF NOT EXISTS "tb_prestador_especialidades_prestador_id_idx"
  ON "schs2vet"."tb_prestador_especialidades" ("prestador_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_prestador_especialidades_prestador_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_prestador_especialidades"
      ADD CONSTRAINT "tb_prestador_especialidades_prestador_id_fkey"
      FOREIGN KEY ("prestador_id") REFERENCES "schs2vet"."tb_prestadores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_prestador_especialidades_especialidade_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_prestador_especialidades"
      ADD CONSTRAINT "tb_prestador_especialidades_especialidade_id_fkey"
      FOREIGN KEY ("especialidade_id") REFERENCES "schs2vet"."tb_especialidades"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS — TENANT VIA PAI (tb_prestadores), mesmo padrão de tb_fornecedor_especialidades
-- (20260806180000_fase7_rls_geral, linhas 220-226).
ALTER TABLE "schs2vet"."tb_prestador_especialidades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prestador_especialidades" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prestador_especialidades" ON "schs2vet"."tb_prestador_especialidades";
CREATE POLICY "tenant_tb_prestador_especialidades" ON "schs2vet"."tb_prestador_especialidades"
  USING ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_prestadores" p0 WHERE p0."id" = "prestador_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"()))
  WITH CHECK ("schs2vet"."app_empresa_id"() IS NULL OR EXISTS (SELECT 1 FROM "schs2vet"."tb_prestadores" p0 WHERE p0."id" = "prestador_id" AND p0."empresa_id" = "schs2vet"."app_empresa_id"()));
