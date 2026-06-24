-- Adiciona coluna tipo_amostra (text[]) em tb_exame_itens
-- Permite correlacionar cada exame com seus tipos de amostra compatíveis

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'schs2vet'
      AND table_name   = 'tb_exame_itens'
      AND column_name  = 'tipo_amostra'
  ) THEN
    ALTER TABLE schs2vet.tb_exame_itens
    ADD COLUMN tipo_amostra text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;
