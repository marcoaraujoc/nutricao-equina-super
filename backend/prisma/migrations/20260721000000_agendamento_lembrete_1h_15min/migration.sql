-- Lembretes de agendamento: substitui o modelo D-1/2h por 1h antes / 15min antes,
-- enviados a proprietário E veterinário. Colunas antigas (lembrete_wa_1dia_em /
-- lembrete_wa_2h_em) são mantidas na tabela (não usadas mais) para não quebrar
-- nada que ainda as referencie; os novos flags são independentes.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'schs2vet' AND table_name = 'tb_agendamentos_clinicos'
                   AND column_name = 'lembrete_wa_1h_em') THEN
    ALTER TABLE "schs2vet"."tb_agendamentos_clinicos" ADD COLUMN "lembrete_wa_1h_em" TIMESTAMP(3);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'schs2vet' AND table_name = 'tb_agendamentos_clinicos'
                   AND column_name = 'lembrete_wa_15min_em') THEN
    ALTER TABLE "schs2vet"."tb_agendamentos_clinicos" ADD COLUMN "lembrete_wa_15min_em" TIMESTAMP(3);
  END IF;
END $$;
