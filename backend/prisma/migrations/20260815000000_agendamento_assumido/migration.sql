-- Rastro de quem PERDEU o atendimento quando alguém o assumiu.
--
-- POR QUÊ: `assumir` (agenda e evolução) apenas troca o `veterinario_id`. Depois da
-- troca não sobra nada na tela dizendo que aquele atendimento veio de outro
-- profissional — some da agenda de um e aparece na do outro sem explicação. O
-- AuditLog registra o evento, mas é texto livre e não serve para pintar a linha.
--
-- `assumido_de_id` = o profissional que estava com o atendimento ANTES (pode ser NULL
-- quando o agendamento não tinha responsável). `assumido_em` marca o instante — é o
-- que permite exibir só a última troca e diferenciar "assumido agora" de histórico.
-- Sem FK ON DELETE CASCADE: excluir o usuário não pode apagar o agendamento, então
-- SET NULL (o selo passa a mostrar só que houve troca, sem o nome).

ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
  ADD COLUMN IF NOT EXISTS "assumido_de_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "assumido_em"    TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tb_agendamentos_clinicos_assumido_de_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_agendamentos_clinicos"
      ADD CONSTRAINT "tb_agendamentos_clinicos_assumido_de_id_fkey"
      FOREIGN KEY ("assumido_de_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_agendamentos_clinicos_assumido_de_id_idx"
  ON "schs2vet"."tb_agendamentos_clinicos"("assumido_de_id");
