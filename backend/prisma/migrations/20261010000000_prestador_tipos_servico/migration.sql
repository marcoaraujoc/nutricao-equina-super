-- Prestador: VÁRIOS tipos de serviço (2026-09-15)
--
-- A lista continua na MESMA coluna, como CSV — é o formato que os leitores já
-- esperam: `EncaminhamentoController` monta o filtro de serviços com
-- `tipoServico.split(',')` e `PrestadorController.normalizarTipos` já compara a
-- LISTA na checagem de duplicidade. O que faltava era o CADASTRO saber produzi-la.
--
-- 50 caracteres não comportam quatro atuações — "Fisioterapeuta, Quiroprata,
-- Radiologista" já ocupa 40, e o quarto tipo passa do limite. Estourar NÃO vira
-- erro de validação:
-- vira `22001 value too long for type character varying(50)` do Postgres, a mesma
-- armadilha do status VARCHAR(20) registrada no CLAUDE.md.
--
-- ALARGAR é operação SEGURA: não há perda de dado, nenhuma linha existente muda,
-- e prestador com um tipo só continua exatamente como está.
-- ⚠️ `tb_fornecedores.tipo_servico` NÃO é tocada: lá o campo é DERIVADO da 1ª
-- especialidade (tb_fornecedor_especialidades), nunca uma lista digitada.

ALTER TABLE "schs2vet"."tb_prestadores"
  ALTER COLUMN "tipo_servico" TYPE VARCHAR(255);
