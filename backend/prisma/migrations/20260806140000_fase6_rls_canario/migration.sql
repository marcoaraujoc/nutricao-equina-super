-- ════════════════════════════════════════════════════════════════════════════
-- FASE 6 DO MULTI-TENANCY — RLS CANÁRIO
-- (docs/MULTI-TENANCY-PLANO.md §6, linha "6. RLS canário")
--
-- Liga Row-Level Security em UMA tabela de baixo risco, para provar o mecanismo
-- ponta a ponta antes de aplicá-lo às 56 tabelas de tenant.
--
-- Canária: `tb_movimentos_estoque` — 32 linhas, 4 empresas distintas, e nenhuma
-- tela crítica depende dela (é o extrato de entradas/saídas da farmácia).
--
-- ── POR QUE `FORCE ROW LEVEL SECURITY` ──────────────────────────────────────
-- ⚠️ Esta é a linha que faz o RLS existir de verdade nesta base. O `ENABLE` sozinho
-- **NÃO se aplica ao DONO da tabela**, e a aplicação conecta como `nutriadmin`, que é
-- exatamente o dono. Sem o `FORCE`, tudo abaixo passaria a existir e não filtraria
-- absolutamente nada — o pior resultado possível: a aparência de isolamento sem o
-- isolamento. `FORCE` sujeita o dono às policies como qualquer outro papel.
--
-- ── A VARIÁVEL DE TENANT ────────────────────────────────────────────────────
-- `app.empresa_id`, setada por `set_config('app.empresa_id', $1, true)` — o `true`
-- final é o que a torna **local à transação**: ela morre no COMMIT/ROLLBACK e não
-- vaza para a próxima requisição que reusar a mesma conexão do pool. Sem isso, um
-- pool de conexões vira vazamento entre clínicas.
--
-- ── O ESCAPE ENQUANTO A FASE 6 É CANÁRIO ────────────────────────────────────
-- 🔴 A policy PERMITE quando a variável NÃO está setada. É deliberado e é
-- TEMPORÁRIO: hoje só os caminhos instrumentados por `lib/tenantDb.js` a setam;
-- cron, ADMIN de plataforma e as 98 chamadas de SQL cru ainda não. Sem o escape,
-- ligar o RLS devolveria zero linha nesses caminhos e quebraria a farmácia.
--
-- ⚠️ **O ESCAPE PRECISA MORRER NA FASE 7.** Enquanto ele existir, o RLS protege
-- quem passa pelo caminho instrumentado e não protege ninguém mais. Há um teste
-- (`__tests__/rlsCanario.test.js`) que documenta o escape e falha se a policy for
-- declarada "pronta" sem removê-lo.
--
-- ── A ROLE `zls2vetp1` NÃO É CRIADA AQUI — e é por um bom motivo ────────────
-- 🔴 `nutriadmin` (o usuário da aplicação) **não tem `CREATEROLE`**, e a migration
-- falhou ao tentar. Isso é higiene, não obstáculo: o usuário da aplicação não deve
-- mesmo poder criar papéis. Criar role é ato de OPERAÇÃO, feito por superusuário.
--
-- A canária NÃO depende dela: quem faz o RLS valer para `nutriadmin` é o `FORCE`
-- abaixo. A role é o destino da FASE 7, quando a aplicação passar a conectar sem ser
-- dona de nada. O passo, para rodar com superusuário quando chegar a hora:
--
--   CREATE ROLE zls2vetp1 LOGIN PASSWORD '<segredo fora do repositório>' NOBYPASSRLS;
--   GRANT USAGE ON SCHEMA schs2vet TO zls2vetp1;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA schs2vet TO zls2vetp1;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA schs2vet TO zls2vetp1;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA schs2vet
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zls2vetp1;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA schs2vet
--     GRANT USAGE, SELECT ON SEQUENCES TO zls2vetp1;
--
-- ⚠️ A senha NUNCA entra em migration versionada — vai para a `DATABASE_URL` do
-- ambiente. E `NOBYPASSRLS` é obrigatório: uma role com `BYPASSRLS` ignora TODAS as
-- policies e transforma a fase 7 inteira em decoração.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Função de leitura do tenant ─────────────────────────────────────────────
-- Encapsula o `current_setting(..., true)` para que as 56 policies da fase 7 não
-- repitam a expressão. `STABLE` (não `IMMUTABLE`): o valor muda entre transações.
-- ⚠️ NÃO é `SECURITY DEFINER` — não precisa de privilégio, e marcá-la assim abriria
-- uma porta para escalonamento sem nenhum ganho.
CREATE OR REPLACE FUNCTION "schs2vet"."app_empresa_id"()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.empresa_id', true), '')::integer;
$$;

COMMENT ON FUNCTION "schs2vet"."app_empresa_id"() IS
  'Empresa do contexto da transação corrente. NULL = sem tenant (cron, ADMIN de plataforma, caminho ainda não instrumentado).';

-- ── Canária: tb_movimentos_estoque ──────────────────────────────────────────
-- ⚠️ Esta tabela é TENANT VIA PAI: não tem `empresa_id` próprio, herda de
-- `tb_estoque_clinica` pelo `estoqueId`. A policy precisa de SUBCONSULTA — e é
-- justamente por isso que ela foi mantida como canária: 32 das 90 tabelas estão
-- nessa situação, e é o caso DIFÍCIL que precisa ser provado, não o fácil.
ALTER TABLE "schs2vet"."tb_movimentos_estoque" ENABLE  ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_movimentos_estoque" FORCE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_movimentos_estoque" ON "schs2vet"."tb_movimentos_estoque";
CREATE POLICY "tenant_movimentos_estoque"
  ON "schs2vet"."tb_movimentos_estoque"
  USING (
    "schs2vet"."app_empresa_id"() IS NULL          -- 🔴 escape temporário (some na fase 7)
    OR "estoqueId" IN (
      SELECT e."id" FROM "schs2vet"."tb_estoque_clinica" e
      WHERE e."empresaId" = "schs2vet"."app_empresa_id"()
    )
  )
  WITH CHECK (
    "schs2vet"."app_empresa_id"() IS NULL
    OR "estoqueId" IN (
      SELECT e."id" FROM "schs2vet"."tb_estoque_clinica" e
      WHERE e."empresaId" = "schs2vet"."app_empresa_id"()
    )
  );

-- `WITH CHECK` além de `USING` não é redundância: `USING` filtra o que se LÊ (e o que
-- se pode alcançar num UPDATE/DELETE); `WITH CHECK` valida o que se ESCREVE. Sem ele,
-- uma clínica poderia INSERIR movimento no estoque de outra — leria de volta vazio,
-- mas a linha estaria lá, contaminando o saldo alheio.
