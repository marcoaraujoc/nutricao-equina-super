-- Agendamentos do animal (consultas, vacinas, retornos, exames, procedimentos)
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_agendamentos_clinicos" (
  "id"             SERIAL PRIMARY KEY,
  "animal_id"      INTEGER      NOT NULL,
  "veterinario_id" INTEGER,
  "tipo"           VARCHAR(20)  NOT NULL DEFAULT 'CONSULTA',
  "titulo"         VARCHAR(255) NOT NULL,
  "data_hora"      TIMESTAMP(3) NOT NULL,
  "observacao"     TEXT,
  "status"         VARCHAR(20)  NOT NULL DEFAULT 'AGENDADO',
  "ativo"          BOOLEAN      NOT NULL DEFAULT true,
  "criado_por_id"  INTEGER,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tb_agendamentos_clinicos_animal_id_fkey"
    FOREIGN KEY ("animal_id") REFERENCES "schs2vet"."tb_animais"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tb_agendamentos_clinicos_veterinario_id_fkey"
    FOREIGN KEY ("veterinario_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "tb_agendamentos_clinicos_criado_por_id_fkey"
    FOREIGN KEY ("criado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_animal_id_data_hora_idx"
  ON "schs2vet"."tb_agendamentos_clinicos"("animal_id", "data_hora");
