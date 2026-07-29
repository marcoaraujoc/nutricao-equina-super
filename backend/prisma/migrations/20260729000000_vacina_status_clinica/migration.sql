-- Ciclo de vida da vacina clínica: SALVA (rascunho) -> FINALIZADA (aplicação
-- confirmada), espelhando o padrão de status de Exames (SOLICITADO->CONCLUIDO)
-- e Encaminhamento (PENDENTE->CONCLUIDO). Novos registros nascem SALVA;
-- registros legados (já aplicados) são backfilled para FINALIZADA.
ALTER TABLE "schs2vet"."tb_vacinas_clinicas"
  ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'SALVA';

UPDATE "schs2vet"."tb_vacinas_clinicas" SET "status" = 'FINALIZADA';
