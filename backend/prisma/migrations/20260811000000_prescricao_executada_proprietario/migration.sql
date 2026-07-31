-- Prescrição que o PROPRIETÁRIO aplica em casa.
--
-- Marcada assim, ela é orientação clínica e não serviço da clínica:
--   * não aparece na tela de Execução de Prescrição (plantão);
--   * por consequência, nunca gera FaturaItem nem debita/reserva estoque —
--     a cobrança e a baixa acontecem SÓ na execução (ver CLAUDE.md, fluxo da vacina
--     e do grupo de prescrição).
--
-- Default false: toda prescrição existente continua sendo executada pela clínica.

ALTER TABLE "schs2vet"."tb_prescricao_grupos"
  ADD COLUMN IF NOT EXISTS "executada_pelo_proprietario" BOOLEAN NOT NULL DEFAULT false;
