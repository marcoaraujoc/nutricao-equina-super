-- AddColumns: numero, tipo_atendimento, quantidade, valor em tb_vacinas_clinicas

ALTER TABLE schs2vet.tb_vacinas_clinicas
  ADD COLUMN IF NOT EXISTS numero            INTEGER,
  ADD COLUMN IF NOT EXISTS tipo_atendimento  VARCHAR(2) DEFAULT 'VC',
  ADD COLUMN IF NOT EXISTS quantidade        INTEGER    DEFAULT 1,
  ADD COLUMN IF NOT EXISTS valor             DECIMAL(10,2);

CREATE INDEX IF NOT EXISTS idx_vacina_clinica_numero
  ON schs2vet.tb_vacinas_clinicas("animalId", tipo_atendimento);
