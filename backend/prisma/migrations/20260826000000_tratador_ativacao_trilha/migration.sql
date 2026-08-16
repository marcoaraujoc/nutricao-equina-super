-- Trilha de ATIVAÇÃO/INATIVAÇÃO para Tratador — mesma lógica já aplicada a
-- Fornecedor/Prestador (migration 20260825000000_fornecedor_prestador_ativacao_catalogo),
-- replicada aqui para fechar a paridade de tela pedida entre Fornecedores e Tratadores.
-- Sem FK CASCADE: excluir quem fez a ação não pode apagar nem destravar o registro
-- afetado — SET NULL preserva a data, só perde o nome de quem fez.

ALTER TABLE "schs2vet"."tb_tratadores"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_tratadores_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_tratadores"
      ADD CONSTRAINT "tb_tratadores_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_tratadores_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_tratadores"
      ADD CONSTRAINT "tb_tratadores_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_tratadores_ativo_por_id_idx"   ON "schs2vet"."tb_tratadores"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_tratadores_inativo_por_id_idx" ON "schs2vet"."tb_tratadores"("inativo_por_id");
