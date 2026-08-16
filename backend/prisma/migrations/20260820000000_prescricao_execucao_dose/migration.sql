-- Execução de prescrição por DOSE INDIVIDUAL (não mais 1x por dia).
--
-- Até aqui, um item de prescrição "8 em 8h" era executado com UM clique por DIA,
-- que debitava estoque e faturava a quantidade do dia inteiro de uma vez. Passa a
-- existir uma linha por DOSE realmente aplicada, com horário previsto x executado
-- e quem executou — base do reagendamento dinâmico ("rolling schedule": a próxima
-- dose é sempre horário REAL da última + intervalo da frequência, não uma grade
-- fixa desde `horaInicio`) e da auditoria de execução antecipada/atrasada.
--
-- `tb_prescricoes.executadoEm` MUDA DE SENTIDO: deixa de ser "1ª execução travou o
-- item" e passa a ser "horário da ÚLTIMA dose executada" (já era assim no código —
-- PrescricaoGrupoController.executar já atualizava a cada dia; a coluna só ganha
-- granularidade de DOSE em vez de DIA agora).

-- ── tb_prescricao_execucoes_dose — log append-only, uma linha por dose ─────────
CREATE TABLE IF NOT EXISTS "schs2vet"."tb_prescricao_execucoes_dose" (
    "id"                SERIAL       NOT NULL,
    "prescricaoId"      INTEGER      NOT NULL,
    "grupoId"           INTEGER      NOT NULL,
    "animalId"          INTEGER      NOT NULL,
    "numero_dose"       INTEGER      NOT NULL,
    "horario_previsto"  TIMESTAMP(3) NOT NULL,
    "horario_executado" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executado_por_id"  INTEGER,
    "classificacao"     VARCHAR(20)  NOT NULL, -- NO_HORARIO | ANTECIPADA | ATRASADA
    "diferenca_minutos" INTEGER      NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tb_prescricao_execucoes_dose_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tb_prescricao_execucoes_dose_prescricaoId_idx"
    ON "schs2vet"."tb_prescricao_execucoes_dose"("prescricaoId");
CREATE INDEX IF NOT EXISTS "tb_prescricao_execucoes_dose_grupoId_idx"
    ON "schs2vet"."tb_prescricao_execucoes_dose"("grupoId");

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_prescricao_execucoes_dose"
    ADD CONSTRAINT "tb_prescricao_execucoes_dose_prescricaoId_fkey"
    FOREIGN KEY ("prescricaoId") REFERENCES "schs2vet"."tb_prescricoes"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "schs2vet"."tb_prescricao_execucoes_dose"
    ADD CONSTRAINT "tb_prescricao_execucoes_dose_executado_por_id_fkey"
    FOREIGN KEY ("executado_por_id") REFERENCES "schs2vet"."users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tb_prescricao_execucoes_dose — TENANT VIA PAI (tb_prescricao_grupos), mesmo
-- padrão de tb_prescricoes (20260806220000_fase7c_remove_escape_rls) — lê a coluna
-- `grupoId` denormalizada em vez de saltar por tb_prescricoes, um hop a menos.
ALTER TABLE "schs2vet"."tb_prescricao_execucoes_dose" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_prescricao_execucoes_dose" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_tb_prescricao_execucoes_dose" ON "schs2vet"."tb_prescricao_execucoes_dose";
CREATE POLICY "tenant_tb_prescricao_execucoes_dose" ON "schs2vet"."tb_prescricao_execucoes_dose"
  USING ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())))
  WITH CHECK ("schs2vet"."app_plataforma"() OR (EXISTS (SELECT 1 FROM "schs2vet"."tb_prescricao_grupos" p0 WHERE p0."id" = "grupoId" AND p0."empresaId" = "schs2vet"."app_empresa_id"())));

-- ── tb_prescricoes — colunas novas (rolling schedule) ───────────────────────────
ALTER TABLE "schs2vet"."tb_prescricoes"
  ADD COLUMN IF NOT EXISTS "doses_executadas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "proxima_dose_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "proxima_dose_aviso_enviado" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "tb_prescricoes_proxima_dose_em_idx"
    ON "schs2vet"."tb_prescricoes"("proxima_dose_em");

-- ── Backfill — best-effort, não tenta reconstruir histórico que não existe ─────
-- Item ativo, elegível ao fluxo novo (tem horaInicio, frequência não é
-- agora/SOS/seNecessario) e que já teve pelo menos 1 execução no modelo antigo:
-- assume 1 dose dada e projeta a próxima a partir do horário real da última
-- execução conhecida (`executadoEm`). Não cria linha em
-- tb_prescricao_execucoes_dose retroativa — não há como saber os horários das
-- doses passadas, e isso não trava nem duplica cobrança (nada é redebitado).
UPDATE "schs2vet"."tb_prescricoes"
   SET "doses_executadas" = 1,
       "proxima_dose_em" = "executadoEm" + (
         CASE "frequencia"
           WHEN '1xDia'    THEN INTERVAL '24 hours'
           WHEN '12em12h'  THEN INTERVAL '12 hours'
           WHEN '8em8h'    THEN INTERVAL '8 hours'
           WHEN '6em6h'    THEN INTERVAL '6 hours'
           WHEN '4em4h'    THEN INTERVAL '4 hours'
           WHEN '1em1h'    THEN INTERVAL '1 hours'
           WHEN 'continuo' THEN INTERVAL '24 hours'
           WHEN '1x2dias'  THEN INTERVAL '2 days'
           WHEN '1x3dias'  THEN INTERVAL '3 days'
           WHEN '1xSemana' THEN INTERVAL '7 days'
           WHEN '1x21dias' THEN INTERVAL '21 days'
           WHEN '1x30dias' THEN INTERVAL '30 days'
           WHEN '1x90dias' THEN INTERVAL '90 days'
           ELSE INTERVAL '24 hours'
         END
       )
 WHERE "executadoEm" IS NOT NULL
   AND "ativo" = true
   AND "horaInicio" IS NOT NULL
   AND "frequencia" NOT IN ('agora', 'SOS', 'seNecessario');

-- Item elegível que ainda NÃO foi executado nenhuma vez: a 1ª dose esperada é
-- dataInicio + horaInicio.
UPDATE "schs2vet"."tb_prescricoes"
   SET "doses_executadas" = 0,
       "proxima_dose_em" = date_trunc('day', "dataInicio")
         + (split_part("horaInicio", ':', 1) || ' hours')::interval
         + (split_part("horaInicio", ':', 2) || ' minutes')::interval
 WHERE "executadoEm" IS NULL
   AND "ativo" = true
   AND "horaInicio" IS NOT NULL
   AND "frequencia" NOT IN ('agora', 'SOS', 'seNecessario');
