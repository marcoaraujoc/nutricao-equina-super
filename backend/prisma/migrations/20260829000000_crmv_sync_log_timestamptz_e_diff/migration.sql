-- tb_crmv_sync_log estava com "executadoEm" como TIMESTAMP (sem timezone). O valor
-- gravado por Prisma sempre foram os dígitos de now() em UTC, mas a coluna sem timezone
-- exibia esses dígitos literalmente (ex.: "10:37") a quem consultasse o banco direto,
-- levando a crer que era hora local de Brasília — quando a hora local real era "07:37"
-- (UTC-3). Convertendo para TIMESTAMPTZ com "AT TIME ZONE 'UTC'" (não o padrão do
-- Postgres, que usaria o timezone da sessão) preserva o instante correto e passa a
-- exibir automaticamente convertido para o timezone da sessão (America/Sao_Paulo) em
-- qualquer client SQL.
ALTER TABLE "schs2vet"."tb_crmv_sync_log"
  ALTER COLUMN "executadoEm" TYPE TIMESTAMPTZ USING "executadoEm" AT TIME ZONE 'UTC';

-- Colunas novas para auditar o diff de cada execução (sincronismo passou a ser
-- incremental por UF, não mais delete-all + reinsert no final).
ALTER TABLE "schs2vet"."tb_crmv_sync_log"
  ADD COLUMN "totalAdicionados" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalRemovidos"   INTEGER NOT NULL DEFAULT 0;
