-- Fuso horário da EMPRESA (IANA, ex.: "America/Manaus").
--
-- POR QUÊ: a aplicação roda em todo o Brasil, que tem QUATRO fusos —
--   UTC−2  America/Noronha
--   UTC−3  America/Sao_Paulo   (Brasília, SP, Rio, Sul, Nordeste)
--   UTC−4  America/Manaus, America/Cuiaba, America/Campo_Grande, America/Porto_Velho,
--          America/Boa_Vista
--   UTC−5  America/Rio_Branco, America/Eirunepe
-- Até aqui o backend assumia `America/Sao_Paulo` fixo (process.env.TZ em server.ts),
-- então para uma clínica em UTC−4/−5 o "hoje" da fila do plantão e o horário nos
-- e-mails/WhatsApp saíam 1-2h deslocados do relógio local — uma dose aplicada às 22h
-- em Rio Branco podia ser contabilizada no dia seguinte.
--
-- NULL = comportamento anterior (America/Sao_Paulo). Nenhuma linha existente muda de
-- comportamento ao aplicar esta migration: quem não configurar segue exatamente como
-- está hoje. É por isso que NÃO há backfill — preencher todo mundo com São Paulo
-- transformaria uma suposição implícita em dado afirmado, e a clínica de Manaus
-- ficaria com o fuso errado gravado sem nunca ter escolhido.

ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN IF NOT EXISTS "fuso_horario" VARCHAR(60);
