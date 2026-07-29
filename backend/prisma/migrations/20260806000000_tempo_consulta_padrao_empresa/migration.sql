-- Tempo de consulta PADRÃO da empresa (minutos).
-- Passa a ser a fonte do que o profissional não informar no card "Locais de trabalho":
-- especialidade sem tempo próprio usa este valor (herança dinâmica — mudou aqui, mudou
-- na agenda de todo mundo que não configurou). NULL = cai no padrão do sistema (60 min),
-- que é a grade que a agenda sempre teve.
ALTER TABLE schs2vet.tb_empresa_configuracoes
  ADD COLUMN IF NOT EXISTS "tempo_consulta_padrao_min" INTEGER;
