-- Agenda (horário) dinâmica das tarefas agendadas (cron)
CREATE TABLE "schs2vet"."tb_cron_agenda" (
  "id"        SERIAL       NOT NULL,
  "chave"     TEXT         NOT NULL,
  "nome"      TEXT         NOT NULL,
  "cronExpr"  TEXT         NOT NULL,
  "ativo"     BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tb_cron_agenda_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tb_cron_agenda_chave_key" ON "schs2vet"."tb_cron_agenda"("chave");
