-- Lembretes de agendamento por WhatsApp: controle de idempotência (D-1 e 2h antes)
ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN "lembrete_wa_1dia_em" TIMESTAMP(3),
  ADD COLUMN "lembrete_wa_2h_em"   TIMESTAMP(3);
