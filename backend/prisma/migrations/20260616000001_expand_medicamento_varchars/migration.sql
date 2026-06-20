-- Expand varchar limits on tb_medicamentos and tb_medicamento_vias
ALTER TABLE schs2vet."tb_medicamentos"
  ALTER COLUMN "nome"              TYPE VARCHAR(500),
  ALTER COLUMN "formaFarmaceutica" TYPE VARCHAR(255),
  ALTER COLUMN "unidade"           TYPE VARCHAR(100),
  ALTER COLUMN "apresentacao"      TYPE VARCHAR(255),
  ALTER COLUMN "classificacao"     TYPE VARCHAR(255);

ALTER TABLE schs2vet."tb_medicamento_vias"
  ALTER COLUMN "via"               TYPE VARCHAR(255);
