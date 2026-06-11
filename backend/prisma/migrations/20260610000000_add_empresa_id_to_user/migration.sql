-- Adiciona empresa_id ao User para associar proprietários à empresa diretamente
-- Necessário para que sócias vejam proprietários criados sem animal vinculado

ALTER TABLE schs2vet.users ADD COLUMN IF NOT EXISTS empresa_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'schs2vet'
      AND constraint_name   = 'users_empresa_id_fkey'
  ) THEN
    ALTER TABLE schs2vet.users
      ADD CONSTRAINT users_empresa_id_fkey
        FOREIGN KEY (empresa_id) REFERENCES schs2vet.tb_empresas(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_empresa_id_idx ON schs2vet.users(empresa_id);
