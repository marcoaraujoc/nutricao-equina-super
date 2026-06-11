-- AddColumn: localizacao_id em tb_animais
ALTER TABLE schs2vet.tb_animais ADD COLUMN localizacao_id INTEGER;

-- FK para tb_localizacoes_animal (SET NULL quando a localização for excluída — impossível por regra, mas por segurança)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'schs2vet' AND table_name = 'tb_localizacoes_animal') THEN
    ALTER TABLE schs2vet.tb_animais
      ADD CONSTRAINT fk_animal_localizacao
      FOREIGN KEY (localizacao_id)
      REFERENCES schs2vet.tb_localizacoes_animal(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Index
CREATE INDEX idx_tb_animais_localizacao_id ON schs2vet.tb_animais(localizacao_id);
