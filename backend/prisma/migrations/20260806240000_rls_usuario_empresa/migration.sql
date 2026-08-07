-- ════════════════════════════════════════════════════════════════════════════
-- RLS EM tb_usuario_empresa — DEFESA EM PROFUNDIDADE (2026-08-06)
--
-- POR QUÊ, mesmo com a aplicação já filtrando: esta tabela guarda o dado mais
-- sensível do schema — nome, CPF/CNPJ, endereço e a REMUNERAÇÃO (tipo/forma/valor de
-- pagamento) de cada pessoa em cada empresa. As 6 leituras de hoje filtram por
-- empresa na aplicação (auditado uma a uma), mas um único call site futuro sem filtro
-- vazaria salário e documento entre clínicas, e nada no banco o seguraria. Esta
-- migration acrescenta a segunda camada — o mesmo padrão das outras 57 tabelas de
-- tenant.
--
-- Até aqui a tabela era CONTROL PLANE (sem RLS) porque o `auth.js` a lê ANTES de
-- existir tenant. Isso foi resolvido no código (mesma leva desta migration):
--   • `resolverTipoNoContexto` (auth) agora roda dentro de `comEmpresa(req.empresaId)`
--     → carimba `app.empresa_id` para a leitura por (userId, empresaId);
--   • `podeAcessarSistema` e `empresasSemAcesso` (leituras "por user_id", cross-empresa,
--     do fluxo de LOGIN) rodam sob `comEscopoPlataforma` + `WHERE user_id = $1`
--     → veem todas as empresas DAQUELE usuário, de nenhum outro.
-- Sem esses dois ajustes, ligar o RLS aqui trancaria o login. NÃO ligue o RLS desta
-- tabela sem eles.
--
-- ⚠️ A policy é IDÊNTICA à das demais tabelas de tenant (padrão pós-fase 7c):
--   sem carimbo → NADA (fail-closed);  plataforma → tudo;  empresa → só a dela.
-- O `WITH CHECK` recusa gravar linha de OUTRA empresa (inclusive por engano de código).
--
-- Grants: já concedidos em 20260806160000 (SELECT/INSERT/UPDATE/DELETE em ALL TABLES)
-- e por ALTER DEFAULT PRIVILEGES — nada a fazer aqui.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "schs2vet"."tb_usuario_empresa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schs2vet"."tb_usuario_empresa" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_tb_usuario_empresa" ON "schs2vet"."tb_usuario_empresa";
CREATE POLICY "tenant_tb_usuario_empresa" ON "schs2vet"."tb_usuario_empresa"
  USING      ("schs2vet"."app_plataforma"() OR "empresa_id" = "schs2vet"."app_empresa_id"())
  WITH CHECK ("schs2vet"."app_plataforma"() OR "empresa_id" = "schs2vet"."app_empresa_id"());
