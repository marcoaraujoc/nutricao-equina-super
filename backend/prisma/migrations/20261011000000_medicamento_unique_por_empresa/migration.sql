-- 🔴 A CHAVE ÚNICA DO CATÁLOGO IGNORAVA A EMPRESA — e isso tornava o COPY-ON-WRITE
-- IMPOSSÍVEL (2026-09-16).
--
-- O QUE HAVIA: `tb_medicamentos_nome_formaFarmaceutica_apresentacao_key`, UNIQUE em
-- (nome, formaFarmaceutica, apresentacao). Ela nasceu em 2026-05-27, quando a tabela
-- ainda se chamava `tb_produtos` e o catálogo era SÓ GLOBAL — não existia `empresa_id`.
--
-- O QUE QUEBROU: desde 2026-09-12 `tb_medicamentos` é CATÁLOGO MISTO (empresa_id NULO =
-- linha global de todas as clínicas; setado = cópia daquela clínica), e alterar um item
-- GLOBAL cria a CÓPIA da empresa (`lib/unidadeMedicamento.js#criarCopiaDaEmpresa`,
-- reusada por `lib/catalogoEmpresa.js`). A cópia nasce com o MESMO nome, forma e
-- apresentação da linha global — que é exatamente o que a chave antiga proíbe. Toda
-- tentativa morria com `Unique constraint failed`.
-- ⚠️ MEDIDO ANTES DE MIGRAR: 8.255 linhas na tabela e **ZERO** com `empresa_id`
-- preenchido. Nenhuma cópia jamais foi criada — a regra existia no código e o banco a
-- recusava desde o primeiro dia.
--
-- E ERA PIOR QUE O ERRO NA TELA: sem `empresa_id` na chave, a cópia da clínica A
-- também BLOQUEARIA a cópia da clínica B do mesmo item global. O defeito apareceria de
-- forma intermitente, dependendo do que OUTRA clínica tivesse feito antes.
--
-- A CHAVE NOVA: (nome, formaFarmaceutica, apresentacao, unidade, empresa_id).
--   • `empresa_id` é o que dá a cada clínica o seu próprio espaço de nomes;
--   • `unidade` entra a pedido (2026-09-16): a mesma apresentação em unidade diferente
--     passa a poder coexistir no catálogo.
--
-- ⚠️ `NULLS NOT DISTINCT` (PostgreSQL 15+; esta base é 18.4) NÃO é detalhe: sem ele o
-- Postgres trata cada NULL como valor distinto, e DUAS linhas GLOBAIS com o mesmo nome,
-- forma, apresentação e unidade passariam a ser aceitas — o catálogo do ADMIN perderia
-- a proteção que a chave antiga dava. Com ele, NULL = NULL e a garantia do lado global
-- fica IDÊNTICA à de antes; o que muda é só a clínica ganhar o espaço dela.
--
-- ⚠️ NÃO É POSSÍVEL PÔR "vias" NA CHAVE: a via mora em `tb_medicamento_vias` (1:N), e
-- índice único só alcança colunas da PRÓPRIA tabela. Quem garante a unicidade das vias
-- de um item continua sendo `@@unique([medicamentoId, via])` naquela tabela.
--
-- ⚠️ Esta chave NÃO fica no `schema.prisma`: `@@unique` do Prisma não expressa
-- `NULLS NOT DISTINCT`. É a mesma situação da chave ANTIGA, que também vivia só no
-- banco — a diferença é que agora está documentada aqui.
--
-- ⚠️ REQUER O DONO DA TABELA (`nutriadmin`): `DROP INDEX`/`CREATE INDEX` exigem
-- OWNERSHIP, não GRANT. Aplicar com DATABASE_URL_MIGRATIONS, nunca com o usuário da
-- aplicação — senão morre com `42501 must be owner of table`.
--
-- SEGURANÇA DO DADO: verificado antes de escrever esta migration que NENHUM grupo de
-- (nome, forma, apresentação, unidade, empresa_id) tem mais de uma linha — a criação do
-- índice novo não pode falhar por duplicata, e nenhuma linha é alterada ou removida.

DROP INDEX IF EXISTS "schs2vet"."tb_medicamentos_nome_formaFarmaceutica_apresentacao_key";

CREATE UNIQUE INDEX IF NOT EXISTS "tb_medicamentos_identidade_por_empresa_key"
  ON "schs2vet"."tb_medicamentos"
  ("nome", "formaFarmaceutica", "apresentacao", "unidade", "empresa_id")
  NULLS NOT DISTINCT;
