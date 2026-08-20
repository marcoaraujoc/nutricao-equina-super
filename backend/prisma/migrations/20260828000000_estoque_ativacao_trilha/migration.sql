-- Trilha de ATIVAÇÃO/INATIVAÇÃO para Estoque de Vacina e Estoque de Farmácia —
-- mesma lógica já aplicada a Fornecedor/Prestador (migration
-- 20260825000000_fornecedor_prestador_ativacao_catalogo), agora replicada aqui
-- para levar as telas /estoque-vacina e /farmacia à mesma regra de ativar/
-- inativar (toggle direto, sem justificativa) do /cadastro/fornecedores.
-- Sem FK CASCADE: excluir quem fez a ação não pode apagar nem destravar o
-- registro afetado — SET NULL preserva a data, só perde o nome de quem fez.

ALTER TABLE "schs2vet"."tb_lotes_vacina"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

ALTER TABLE "schs2vet"."tb_estoque_clinica"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_lotes_vacina_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_lotes_vacina"
      ADD CONSTRAINT "tb_lotes_vacina_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_lotes_vacina_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_lotes_vacina"
      ADD CONSTRAINT "tb_lotes_vacina_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_estoque_clinica_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_estoque_clinica"
      ADD CONSTRAINT "tb_estoque_clinica_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_estoque_clinica_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_estoque_clinica"
      ADD CONSTRAINT "tb_estoque_clinica_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_lotes_vacina_ativo_por_id_idx"     ON "schs2vet"."tb_lotes_vacina"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_lotes_vacina_inativo_por_id_idx"   ON "schs2vet"."tb_lotes_vacina"("inativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_estoque_clinica_ativo_por_id_idx"  ON "schs2vet"."tb_estoque_clinica"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_estoque_clinica_inativo_por_id_idx" ON "schs2vet"."tb_estoque_clinica"("inativo_por_id");
