-- TEMPO DE CONSULTA POR ESPECIALIDADE (grade de horários do profissional)
--
-- O tempo é definido no card "Locais de trabalho" do membro, por especialidade
-- exercida NAQUELE local: a mesma especialidade pode levar 30min na clínica e
-- 60min a campo. Formato: { "<especialidadeId>": <minutos> } — espelha o CSV
-- `especialidades_ids` da mesma linha (toda especialidade selecionada tem tempo).
ALTER TABLE "schs2vet"."tb_membro_locais_trabalho"
  ADD COLUMN IF NOT EXISTS "tempos_consulta" JSONB;

-- O agendamento passa a registrar PARA QUAL especialidade é a consulta — é o que
-- define o passo da grade e quantos minutos o horário ocupa.
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "especialidade_id" INTEGER;

-- Duração em minutos GRAVADA no agendamento (snapshot). Não é derivada na leitura
-- de propósito: se o profissional mudar o tempo da especialidade depois, os
-- agendamentos já marcados mantêm a duração com que foram criados — senão a agenda
-- do passado se reescreveria sozinha e slots ocupados mudariam de tamanho.
-- NULL = agendamento anterior a esta migration (a agenda trata como 60min, a grade antiga).
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "duracao_min" INTEGER;

CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_especialidade_id_idx"
  ON "schs2vet"."tb_agendamentos_clinicos" ("especialidade_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'tb_agendamentos_clinicos_especialidade_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
      ADD CONSTRAINT "tb_agendamentos_clinicos_especialidade_id_fkey"
      FOREIGN KEY ("especialidade_id") REFERENCES "schs2vet"."tb_especialidades"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
