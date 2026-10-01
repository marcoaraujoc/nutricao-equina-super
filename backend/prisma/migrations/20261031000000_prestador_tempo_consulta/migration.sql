-- Tempo de consulta do PRESTADOR externo (2026-10-01).
--
-- O prestador que NÃO integra a equipe (cadastro de Prestador sem vínculo de membro
-- na tela Equipe) é agendado em qualquer dia e horário: a única régua da grade dele
-- é a DURAÇÃO do atendimento. NULL = usa o tempo de consulta padrão da empresa
-- (Configurações), que era o comportamento até aqui.
-- DDL puro: não consulta policy de RLS, então não precisa de `app.plataforma`.
ALTER TABLE "schs2vet"."tb_prestadores"
  ADD COLUMN IF NOT EXISTS "tempo_consulta_min" INTEGER;
