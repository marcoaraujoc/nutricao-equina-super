-- Expediente de atendimento (dias da semana + horário) por empresa/equipe
ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN "dias_atendimento"        TEXT,
  ADD COLUMN "hora_inicio_atendimento" VARCHAR(5),
  ADD COLUMN "hora_fim_atendimento"    VARCHAR(5);
