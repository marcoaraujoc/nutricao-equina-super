-- ════════════════════════════════════════════════════════════════════════════
-- FASE 6 — PRIVILÉGIOS DA ROLE DE APLICAÇÃO `zls2vetp1`
--
-- A role foi criada manualmente (com superusuário — `nutriadmin` não tem CREATEROLE,
-- e é bom que não tenha). Ela nasceu correta nos ATRIBUTOS e vazia nos PRIVILÉGIOS:
--
--   rolsuper = false · rolbypassrls = false · rolcreaterole = false · rolcreatedb = false
--   USAGE no schema: NÃO · privilégio em tabela: 0 de 91 · dona de: 0 tabelas
--
-- Esta migration concede o MÍNIMO para a aplicação funcionar. Roda como `nutriadmin`,
-- que é dono das 91 tabelas e portanto pode conceder — não precisa de superusuário.
--
-- ── O QUE ELA **NÃO** RECEBE, E POR QUÊ CADA UM IMPORTA ─────────────────────
--
-- 🔴 **Não é DONA de nenhuma tabela — esta é a regra central.** O dono pode
--    `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`. Se a role da aplicação fosse dona,
--    uma injeção de SQL ou um processo comprometido **desligaria o RLS inteiro** e todo
--    o trabalho das fases 5–7 evaporaria numa linha. A propriedade fica com
--    `nutriadmin`, que roda as MIGRATIONS; a aplicação roda com `zls2vetp1`, que só
--    lê e escreve dado. É essa separação que dá sentido à role — não a role em si.
--
-- 🔴 **NOBYPASSRLS.** Uma role com `BYPASSRLS` ignora TODAS as policies. Concedê-lo
--    "para resolver um problema" transforma a fase 7 em decoração, e o sintoma é
--    justamente NENHUM: a aplicação funciona perfeitamente, sem isolamento nenhum.
--
-- ⚠️ **Sem CREATE no schema.** A aplicação não cria tabela — quem cria é a migration.
--    Com CREATE, ela poderia criar uma tabela SEM RLS e escapar do isolamento por ali.
--
-- ⚠️ **Sem TRUNCATE.** `TRUNCATE` **não passa pelas policies de RLS** (é DDL, não DML):
--    uma role com TRUNCATE apaga a tabela inteira de TODAS as empresas mesmo com o RLS
--    ligado. É a exceção que costuma escapar de quem concede "todos os privilégios".
--
-- ⚠️ **Sem REFERENCES.** Permite criar FK apontando para a tabela e, com isso, inferir
--    a existência de linhas alheias por erro de constraint (§13.4 — o RLS não fecha o
--    canal de erro).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Schema ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA "schs2vet" TO "zls2vetp1";

-- ── Tabelas: só DML (note a AUSÊNCIA de TRUNCATE, REFERENCES e TRIGGER) ─────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA "schs2vet" TO "zls2vetp1";

-- ── Sequences (88 no schema) ────────────────────────────────────────────────
-- ⚠️ Sem isto, TODO `INSERT` numa tabela com id autoincremento falha com
-- "permission denied for sequence". É o esquecimento clássico: o GRANT de tabela
-- passa, a aplicação sobe, e só quebra quando alguém tenta CRIAR alguma coisa.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "schs2vet" TO "zls2vetp1";

-- ── Função de tenant ────────────────────────────────────────────────────────
-- Já é executável via PUBLIC; explicitado para sobreviver a um eventual
-- `REVOKE EXECUTE ... FROM PUBLIC` de endurecimento.
GRANT EXECUTE ON FUNCTION "schs2vet"."app_empresa_id"() TO "zls2vetp1";

-- ── Objetos FUTUROS ─────────────────────────────────────────────────────────
-- ⚠️ `ALTER DEFAULT PRIVILEGES` vale apenas para o que for criado PELA ROLE indicada.
-- O `FOR ROLE "nutriadmin"` é obrigatório e é o erro clássico aqui: sem ele, a regra
-- valeria para quem executou o comando — se um superusuário rodar esta migration, as
-- tabelas criadas depois por `nutriadmin` nasceriam SEM privilégio para a aplicação, e
-- a falha só apareceria na primeira consulta à tabela nova, em produção.
ALTER DEFAULT PRIVILEGES FOR ROLE "nutriadmin" IN SCHEMA "schs2vet"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "zls2vetp1";
ALTER DEFAULT PRIVILEGES FOR ROLE "nutriadmin" IN SCHEMA "schs2vet"
  GRANT USAGE, SELECT ON SEQUENCES TO "zls2vetp1";
ALTER DEFAULT PRIVILEGES FOR ROLE "nutriadmin" IN SCHEMA "schs2vet"
  GRANT EXECUTE ON FUNCTIONS TO "zls2vetp1";

-- ════════════════════════════════════════════════════════════════════════════
-- ⏳ FALTA UM PASSO, E ELE **NÃO** PODE ESTAR AQUI: a SENHA.
--
--   ALTER ROLE "zls2vetp1" LOGIN PASSWORD '<segredo>';
--
-- Exige superusuário (ou CREATEROLE), que `nutriadmin` não tem — e senha em migration
-- versionada é vazamento: fica no git, no histórico e em toda cópia do repositório.
-- O segredo vai para a `DATABASE_URL` do ambiente. Gerar com:
--   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
-- ════════════════════════════════════════════════════════════════════════════
