-- Add bloqueio fields to tb_animais
-- bloqueado: animal locked (awaiting proprietário authorization or provisional 24h window)
-- bloqueioTipo: AGUARDANDO_APROVACAO (formal request) | PROVISIONAL (24h grace, no notification)
-- bloqueioExpira: expiry for PROVISIONAL locks (auto-cancelled by cron after 24h)

ALTER TABLE schs2vet.tb_animais
  ADD COLUMN IF NOT EXISTS bloqueado      BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueio_tipo  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bloqueio_expira TIMESTAMP(3);
