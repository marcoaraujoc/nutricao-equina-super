-- DOCUMENTO DA EMPRESA (CPF/CNPJ) ÚNICO ENTRE EMPRESAS
--
-- POR QUÊ: a empresa é o TENANT que assina o SaaS e o documento é o que a identifica no
-- mundo real. Duas linhas com o mesmo CNPJ são duplicata, não filial.
--
-- ⚠️ REVERTE, para o documento, a decisão de 2026-06-11 (migration 20260611120000) que
-- derrubou o unique global de `cnpj`. Aquela decisão existia porque o GESTOR criava as
-- próprias empresas e podia ter várias; desde 2026-08-06 só o ADMIN da plataforma cria
-- empresa, com plano e gestores. O unique(ownerId, nome, cnpj) segue existindo.
--
-- ⚠️ ANTES DE APLICAR, confira se a base já tem duplicata — o índice não nasce com ela:
--
--   SELECT regexp_replace(COALESCE(documento, cnpj, ''), '[^0-9]', '', 'g') AS doc,
--          count(*), array_agg(id), array_agg(nome)
--     FROM schs2vet.tb_empresas
--    WHERE COALESCE(documento, cnpj, '') <> ''
--    GROUP BY 1 HAVING count(*) > 1;
--
-- Havendo linhas, resolva-as (corrigir o documento ou cancelar a empresa repetida)
-- ANTES de rodar esta migration.

-- 1) `documento` passa a ser a autoridade: herda o `cnpj` legado de quem só tem ele.
--    Sem isto, empresa antiga ficaria fora do índice e o mesmo CNPJ poderia ser
--    cadastrado de novo em `documento` sem colidir com nada.
UPDATE "schs2vet"."tb_empresas"
   SET "documento"     = regexp_replace("cnpj", '[^0-9]', '', 'g'),
       "tipo_documento" = CASE
         WHEN length(regexp_replace("cnpj", '[^0-9]', '', 'g')) = 11 THEN 'CPF'
         ELSE 'CNPJ'
       END
 WHERE "documento" IS NULL
   AND "cnpj" IS NOT NULL
   AND length(regexp_replace("cnpj", '[^0-9]', '', 'g')) IN (11, 14);

-- 2) Máscara fora: a comparação é sempre sobre os dígitos. Linha antiga podia ter
--    `cnpj` gravado como '12.345.678/0001-99', que não casa com o valor normalizado.
UPDATE "schs2vet"."tb_empresas"
   SET "documento" = regexp_replace("documento", '[^0-9]', '', 'g')
 WHERE "documento" IS NOT NULL
   AND "documento" <> regexp_replace("documento", '[^0-9]', '', 'g');

UPDATE "schs2vet"."tb_empresas"
   SET "cnpj" = regexp_replace("cnpj", '[^0-9]', '', 'g')
 WHERE "cnpj" IS NOT NULL
   AND "cnpj" <> regexp_replace("cnpj", '[^0-9]', '', 'g');

-- 3) `cnpj` legado acompanha o documento (mesma informação, duas colunas). Divergentes,
--    a empresa ocuparia DOIS documentos na checagem de unicidade da aplicação.
--    ⚠️ SÓ para documento de 14 dígitos. `cnpj` não guarda apenas o documento: ele
--    SINALIZA "empresa pessoal" — `resolverEscopoConfiguracao` decide por ele se a
--    EmpresaConfiguracao é da empresa (cnpj presente) ou da equipe (null). Escrever um
--    CPF ali mudaria o escopo e a clínica pessoal perderia de vista o logo e o
--    expediente já configurados.
UPDATE "schs2vet"."tb_empresas"
   SET "cnpj" = "documento"
 WHERE "documento" IS NOT NULL
   AND length("documento") = 14
   AND ("cnpj" IS NULL OR "cnpj" <> "documento");

-- 3b) `cnpj` NUNCA guarda CPF. A coluna sinaliza "empresa pessoal" para
--     `resolverEscopoConfiguracao`, então um CPF ali faz a clínica pessoal ser tratada
--     como empresa com CNPJ e a configuração dela ser procurada no escopo errado.
--     Antes de zerar, a configuração que estiver no escopo de EMPRESA é movida para a
--     primeira equipe — que é onde ela passará a ser lida. Sem mover, o gestor abriria
--     as Configurações em branco (logo e expediente ficariam órfãos no escopo antigo).
UPDATE "schs2vet"."tb_empresa_configuracoes" cfg
   SET "equipeId" = eq.id
  FROM "schs2vet"."tb_empresas" e
  JOIN LATERAL (
        SELECT id FROM "schs2vet"."tb_equipes" t
         WHERE t."empresaId" = e.id ORDER BY t.id ASC LIMIT 1
       ) eq ON true
 WHERE cfg."empresaId" = e.id
   AND cfg."equipeId" IS NULL
   AND e."cnpj" IS NOT NULL
   AND length(regexp_replace(e."cnpj", '[^0-9]', '', 'g')) = 11
   -- Não sobrescreve uma configuração que já exista no escopo de destino
   AND NOT EXISTS (
         SELECT 1 FROM "schs2vet"."tb_empresa_configuracoes" c2
          WHERE c2."empresaId" = e.id AND c2."equipeId" = eq.id
       );

UPDATE "schs2vet"."tb_empresas"
   SET "cnpj" = NULL
 WHERE "cnpj" IS NOT NULL
   AND length(regexp_replace("cnpj", '[^0-9]', '', 'g')) = 11;

-- 4) O índice. NULL fica de fora (Postgres trata NULLs como distintos), então a empresa
--    legada sem documento nenhum não trava a migration — quem passou a exigir o campo é
--    a aplicação, na criação e no cadastro fiscal.
CREATE UNIQUE INDEX "tb_empresas_documento_key"
    ON "schs2vet"."tb_empresas"("documento");
