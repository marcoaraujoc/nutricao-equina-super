-- Trilha de ATIVAÇÃO/INATIVAÇÃO para ProprietarioPerfil — mesma lógica já aplicada
-- a Fornecedor/Prestador/Tratador (migrations 20260825000000/20260826000000),
-- replicada aqui para fechar a paridade de tela pedida entre Fornecedores e
-- Proprietários. Sem FK CASCADE: excluir quem fez a ação não pode apagar nem
-- restaurar o registro afetado — SET NULL preserva a data, só perde o nome de
-- quem fez.

ALTER TABLE "schs2vet"."tb_proprietario_perfis"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_proprietario_perfis_ativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_proprietario_perfis"
      ADD CONSTRAINT "tb_proprietario_perfis_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tb_proprietario_perfis_inativo_por_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_proprietario_perfis"
      ADD CONSTRAINT "tb_proprietario_perfis_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_proprietario_perfis_ativo_por_id_idx"   ON "schs2vet"."tb_proprietario_perfis"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "tb_proprietario_perfis_inativo_por_id_idx" ON "schs2vet"."tb_proprietario_perfis"("inativo_por_id");
