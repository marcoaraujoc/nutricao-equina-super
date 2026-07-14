-- Configuração de alertas de tarefas agendadas (cron) + histórico de execuções

CREATE TABLE "schs2vet"."tb_cron_alerta_config" (
  "id"               SERIAL      NOT NULL,
  "emails"           TEXT,
  "notificarSucesso" BOOLEAN     NOT NULL DEFAULT true,
  "ativo"            BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tb_cron_alerta_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "schs2vet"."tb_cron_execucoes" (
  "id"          SERIAL      NOT NULL,
  "nome"        TEXT        NOT NULL,
  "ok"          BOOLEAN     NOT NULL,
  "resumo"      TEXT,
  "erro"        TEXT,
  "notificado"  BOOLEAN     NOT NULL DEFAULT false,
  "executadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tb_cron_execucoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tb_cron_execucoes_executadoEm_idx" ON "schs2vet"."tb_cron_execucoes"("executadoEm");
CREATE INDEX "tb_cron_execucoes_nome_executadoEm_idx" ON "schs2vet"."tb_cron_execucoes"("nome", "executadoEm");
