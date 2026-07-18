-- Expediente de trabalho por profissional (membro da equipe).
-- null = herda o expediente da empresa (EmpresaConfiguracao).
ALTER TABLE "schs2vet"."tb_membros_equipe"
  ADD COLUMN IF NOT EXISTS "diasTrabalho"       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "horaInicioTrabalho" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "horaFimTrabalho"    VARCHAR(5);
