-- 🔴 CORREÇÃO DE ISOLAMENTO — `tb_matriz_perfis` estava visível entre empresas.
--
-- A policy gerada tinha a correlação PERDIDA:
--
--   EXISTS (SELECT 1 FROM tb_perfis_equipe p0
--           WHERE p0."equipeId" = p0."equipeId"        <-- p0 comparado consigo mesmo
--             AND EXISTS (SELECT 1 FROM tb_equipes p1
--                         WHERE p1.id = p0."equipeId" AND p1."empresaId" = app_empresa_id()))
--
-- CAUSA: o gerador (`scripts/gerarPoliciesRls.js`) emitia a coluna da tabela protegida
-- SEM qualificação (`"equipeId"`). Dentro do `EXISTS`, o pai `tb_perfis_equipe` TAMBÉM
-- tem uma coluna `equipeId` — o escopo interno vence, o Postgres resolve a referência
-- para o pai, e a correlação com a linha protegida desaparece. O predicado degenera em
-- "sempre verdadeiro", e a policy passa a significar apenas "esta empresa tem ALGUM
-- perfil de equipe?" — liberando a TABELA INTEIRA.
--
-- EFEITO MEDIDO nesta base: cada uma das 6 empresas enxergava as 6.655 linhas da matriz
-- de permissões (a empresa 42 deveria ver 1.110; a 58, 1.167). O `WITH CHECK` tinha o
-- MESMO defeito, então a escrita também não estava isolada — um gestor podia alterar a
-- matriz de permissões de equipe de OUTRA clínica.
--
-- ⚠️ NENHUM gate existente pegava isso: `tenancyRls.test.js` confere se a tabela TEM
-- policy (tinha), e `rlsCrossTenant.test.js` só amostrava `tb_animais` e `tb_faturas`.
-- Quem pegou foi a varredura nova (`rlsVarreduraTenant.test.js`), que compara os ids
-- visíveis de CADA tabela em CADA empresa e exige conjuntos disjuntos.
--
-- CORREÇÃO: `tb_matriz_perfis` tem `equipeId` PRÓPRIO — não precisa passar por
-- `tb_perfis_equipe`. A policy vai direto ao pai que carrega a empresa, no mesmo
-- formato de `tb_membros_equipe`, e a coluna da tabela protegida fica QUALIFICADA pelo
-- nome real (é isso que a impede de ser capturada pelo escopo do EXISTS).
--
-- O gerador foi corrigido na mesma sessão: `predicadoDaCadeia` agora qualifica o salto 0
-- com `"<schema>"."<tabela>"."<coluna>"`. Sem essa correção, a próxima execução do
-- gerador reintroduziria o defeito.

DROP POLICY IF EXISTS "tenant_tb_matriz_perfis" ON "schs2vet"."tb_matriz_perfis";

CREATE POLICY "tenant_tb_matriz_perfis" ON "schs2vet"."tb_matriz_perfis"
  USING (
    app_plataforma()
    OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_equipes" p0
      WHERE p0."id" = "schs2vet"."tb_matriz_perfis"."equipeId"
        AND p0."empresaId" = app_empresa_id()
    )
  )
  WITH CHECK (
    app_plataforma()
    OR EXISTS (
      SELECT 1 FROM "schs2vet"."tb_equipes" p0
      WHERE p0."id" = "schs2vet"."tb_matriz_perfis"."equipeId"
        AND p0."empresaId" = app_empresa_id()
    )
  );
