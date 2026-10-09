-- =============================================================================
-- LIMPEZA DA PRODUÇÃO — mantém UMA empresa e apaga tudo das demais.
-- Etapa 12 de docs/DEPLOY-PRODUCAO.md ("limpeza dos dados de teste", decisão D1).
--
-- 🔴 SÓ PRODUÇÃO. Rodar no BACKEND, como superusuário `postgres`:
--
--   SIMULAÇÃO (padrão — faz tudo, mostra o relatório e DESFAZ):
--     sudo runuser -u postgres -- psql -d dbs2vet -f /tmp/limparOutrasEmpresas.sql
--
--   APLICAR (só depois de ler o relatório da simulação e de um backup):
--     sudo runuser -u postgres -- psql -d dbs2vet -v aplicar=1 -f /tmp/limparOutrasEmpresas.sql
--
-- COMO FUNCIONA (genérico — não depende de lista de tabelas mantida à mão):
--   1. Confere que a empresa mantida tem o NOME esperado. Diferente → aborta.
--   2. Apaga, em TODA tabela com coluna de empresa (`empresa_id`/`empresaId`), as linhas
--      de OUTRA empresa. Linha com empresa NULA é catálogo GLOBAL e fica.
--   3. Resolve os dependentes pelas chaves estrangeiras, até não sobrar órfão: o que a
--      FK manda apagar (CASCADE/RESTRICT/NO ACTION) é apagado; o que ela manda zerar
--      (SET NULL) é zerado.
--   4. Apaga os USUÁRIOS que não têm mais NENHUM registro apontando para eles (ADMIN da
--      plataforma fica sempre).
--   5. Zera tokens de sessão/senha/2FA e a instância de WhatsApp (apontava para a
--      Evolution de desenvolvimento — a clínica reconecta pelo QR Code).
--
-- TRAVAS (qualquer uma ABORTA e nada é alterado):
--   - nome da empresa diferente do esperado;
--   - algum registro da empresa mantida apontaria para algo apagado (seria apagado ou
--     teria um campo zerado junto);
--   - a empresa mantida terminaria com MENOS linhas do que começou, em qualquer tabela.
--
-- ⚠️ `session_replication_role = replica` desliga a checagem de FK DURANTE a limpeza
--    (é o que permite apagar em qualquer ordem). A integridade é refeita pelo passo 3,
--    que só termina quando uma passada inteira sobre TODAS as FKs não acha órfão.
-- =============================================================================

SET client_encoding = 'UTF8';
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off

\set empresa 69
\set nome 'Equipe Veterinária'
-- Usuários removidos POR DECISÃO (2026-10-08), além dos que a regra genérica já tira.
-- Continuam valendo as travas: se algum registro da empresa mantida apontar para um
-- deles, ou se ele tiver vínculo com ela, o script aborta.
\set remover '159,197,201,205,217'
\if :{?aplicar}
\else
  \set aplicar 0
\endif

BEGIN;
SET LOCAL statement_timeout = 0;
SET LOCAL session_replication_role = replica;
SELECT set_config('app.plataforma', 'on', true),
       set_config('limpeza.empresa', :'empresa', true),
       set_config('limpeza.nome', :'nome', true),
       set_config('limpeza.remover', :'remover', true) \gset _

CREATE TEMP TABLE _rel   (tabela text, acao text, linhas bigint) ON COMMIT DROP;
CREATE TEMP TABLE _antes (tabela regclass, col text, n bigint)   ON COMMIT DROP;

-- ── FKs do schema, com as colunas na ordem certa ─────────────────────────────
CREATE FUNCTION pg_temp.fks()
RETURNS TABLE (child regclass, parent regclass, deltype "char", cc text[], pc text[])
LANGUAGE sql AS $f$
  SELECT c.conrelid::regclass, c.confrelid::regclass, c.confdeltype,
         ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o),
         ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o)
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'schs2vet'::regnamespace
$f$;

CREATE FUNCTION pg_temp.col_empresa(t regclass) RETURNS text LANGUAGE sql AS $f$
  SELECT attname::text FROM pg_attribute
  WHERE attrelid = t AND attname IN ('empresa_id', 'empresaId') AND NOT attisdropped LIMIT 1
$f$;

-- "c" é órfã: todas as colunas da FK preenchidas e nenhum pai correspondente.
CREATE FUNCTION pg_temp.pred_orfao(cc text[], pc text[], parent regclass)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE i int; nn text := ''; j text := '';
BEGIN
  FOR i IN 1 .. array_length(cc, 1) LOOP
    IF i > 1 THEN nn := nn || ' AND '; j := j || ' AND '; END IF;
    nn := nn || format('c.%I IS NOT NULL', cc[i]);
    j  := j  || format('p.%I = c.%I', pc[i], cc[i]);
  END LOOP;
  RETURN format('%s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)', nn, parent, j);
END $f$;

-- Passo 3: resolve órfãos até a passada inteira não mexer em nada.
-- `so_apagar = true` só APAGA (CASCADE/RESTRICT/NO ACTION) e deixa os SET NULL para o fim.
-- ⚠️ A ordem importa para o RELATÓRIO, não para o resultado: zerar antes faria a linha que
-- vai ser apagada logo depois (item da fatura de outra empresa, usuário removido) aparecer
-- como "campo zerado", como se fosse um registro que fica.
CREATE FUNCTION pg_temp.resolver_orfaos(emp int, so_apagar boolean) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE f record; pred text; ce text; sets text; n bigint; prot bigint;
        rodada bigint; total bigint := 0; volta int := 0;
BEGIN
  LOOP
    volta := volta + 1; rodada := 0;
    IF volta > 50 THEN RAISE EXCEPTION 'Órfãos não convergiram em 50 passadas. Nada foi alterado.'; END IF;
    FOR f IN SELECT * FROM pg_temp.fks() WHERE NOT (so_apagar AND deltype = 'n') LOOP
      pred := pg_temp.pred_orfao(f.cc, f.pc, f.parent);
      ce := pg_temp.col_empresa(f.child);
      -- TRAVA: nenhuma linha da empresa mantida pode ser apagada ou ter campo zerado aqui.
      IF ce IS NOT NULL AND f.child <> 'schs2vet.users'::regclass THEN
        EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND c.%I = %s', f.child, pred, ce, emp) INTO prot;
        IF prot > 0 THEN
          RAISE EXCEPTION '% linha(s) da empresa % em % apontam (por %) para um registro que seria apagado. Nada foi alterado.',
            prot, emp, f.child, array_to_string(f.cc, ',');
        END IF;
      END IF;
      IF f.deltype = 'n' THEN
        SELECT string_agg(format('%I = NULL', x), ', ') INTO sets FROM unnest(f.cc) x;
        EXECUTE format('UPDATE %s c SET %s WHERE %s', f.child, sets, pred);
      ELSE
        EXECUTE format('DELETE FROM %s c WHERE %s', f.child, pred);
      END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        INSERT INTO _rel VALUES (f.child::text,
          CASE WHEN f.deltype = 'n' THEN 'campo zerado: ' || array_to_string(f.cc, ',')
               ELSE 'apagada (dependia de registro apagado)' END, n);
        rodada := rodada + n;
      END IF;
    END LOOP;
    total := total + rodada;
    EXIT WHEN rodada = 0;
  END LOOP;
  RETURN total;
END $f$;

-- ── 1. A empresa mantida é a esperada? ───────────────────────────────────────
DO $$
DECLARE emp int := current_setting('limpeza.empresa')::int;
        esperado text := current_setting('limpeza.nome'); real text;
BEGIN
  SELECT nome INTO real FROM schs2vet.tb_empresas WHERE id = emp;
  IF real IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'A empresa % é "%", não "%". Nada foi alterado.', emp, coalesce(real, '(inexistente)'), esperado;
  END IF;
END $$;

\echo
\echo '══ Empresas ANTES ══'
SELECT id, nome, CASE WHEN id = :empresa THEN 'MANTIDA' ELSE 'será apagada' END AS destino
FROM schs2vet.tb_empresas ORDER BY id;

-- Fotografia da empresa mantida, para a trava final.
DO $$
DECLARE t record; n bigint; emp int := current_setting('limpeza.empresa')::int;
BEGIN
  FOR t IN SELECT c.oid::regclass AS tab, a.attname::text AS col
           FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
           WHERE c.relnamespace = 'schs2vet'::regnamespace AND c.relkind = 'r'
             AND a.attname IN ('empresa_id', 'empresaId') AND NOT a.attisdropped
             AND c.relname <> 'users'
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = %s', t.tab, t.col, emp) INTO n;
    INSERT INTO _antes VALUES (t.tab, t.col, n);
  END LOOP;
END $$;

-- ── 2. Linhas das outras empresas ────────────────────────────────────────────
DO $$
DECLARE t record; n bigint; emp int := current_setting('limpeza.empresa')::int;
BEGIN
  FOR t IN SELECT tabela, col FROM _antes LOOP
    EXECUTE format('DELETE FROM %s WHERE %I IS NOT NULL AND %I <> %s', t.tabela, t.col, t.col, emp);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN INSERT INTO _rel VALUES (t.tabela::text, 'apagada (de outra empresa)', n); END IF;
  END LOOP;
  DELETE FROM schs2vet.tb_empresas WHERE id <> emp;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _rel VALUES ('schs2vet.tb_empresas', 'apagada (outra empresa)', n);
END $$;

-- ── 3. Dependentes (só o que é APAGADO; os campos zerados ficam para depois dos usuários) ──
SELECT pg_temp.resolver_orfaos(:empresa, true) \gset _

-- ── 4. Usuários sem nenhum registro restante ─────────────────────────────────
CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT id FROM schs2vet.users
  WHERE coalesce(role::text, '') <> 'ADMIN' AND coalesce("userType"::text, '') <> 'ADMIN';

-- Prende o usuário: registro da empresa mantida (em tabela COM coluna de empresa, só a
-- linha dela — a de empresa NULA é catálogo global, vínculo legado ou LOGIN, e não é
-- vínculo com ninguém) ou registro de tabela SEM coluna de empresa. Não prendem: os
-- anexos PESSOAIS do próprio usuário (perfil de veterinário, histórico de senha, 2FA).
DO $$
DECLARE f record; ce text; emp int := current_setting('limpeza.empresa')::int;
BEGIN
  FOR f IN SELECT * FROM pg_temp.fks()
           WHERE parent = 'schs2vet.users'::regclass
             AND child NOT IN ('schs2vet.users'::regclass, 'schs2vet.tb_mfa_desafios'::regclass,
                               'schs2vet.tb_password_history'::regclass, 'schs2vet.tb_vet_perfil'::regclass)
  LOOP
    ce := pg_temp.col_empresa(f.child);
    IF ce IS NOT NULL THEN
      EXECUTE format('DELETE FROM _cand WHERE id IN (SELECT %I FROM %s WHERE %I IS NOT NULL AND %I = %s)',
                     f.cc[1], f.child, f.cc[1], ce, emp);
    ELSE
      EXECUTE format('DELETE FROM _cand WHERE id IN (SELECT %I FROM %s WHERE %I IS NOT NULL)',
                     f.cc[1], f.child, f.cc[1]);
    END IF;
  END LOOP;
END $$;

-- Remoção por decisão: entram na lista mesmo que a regra os tivesse mantido.
DO $$
DECLARE emp int := current_setting('limpeza.empresa')::int; lig text;
BEGIN
  SELECT string_agg(DISTINCT u.id::text, ', ') INTO lig
  FROM schs2vet.users u
  WHERE u.id = ANY (string_to_array(current_setting('limpeza.remover'), ',')::int[])
    AND (u.role::text = 'ADMIN' OR u."userType"::text = 'ADMIN'
         OR EXISTS (SELECT 1 FROM schs2vet.tb_usuario_empresa ue WHERE ue.user_id = u.id AND ue.empresa_id = emp)
         OR EXISTS (SELECT 1 FROM schs2vet.tb_empresas e WHERE e.id = emp AND e."ownerId" = u.id)
         OR EXISTS (SELECT 1 FROM schs2vet.tb_membros_equipe m JOIN schs2vet.tb_equipes q ON q.id = m."equipeId"
                    WHERE m."userId" = u.id AND q."empresaId" = emp));
  IF lig IS NOT NULL THEN
    RAISE EXCEPTION 'Usuário(s) % da lista de remoção são ADMIN ou têm vínculo com a empresa %. Nada foi alterado.', lig, emp;
  END IF;
  INSERT INTO _cand
    SELECT u.id FROM schs2vet.users u
    WHERE u.id = ANY (string_to_array(current_setting('limpeza.remover'), ',')::int[])
      AND u.id NOT IN (SELECT id FROM _cand);
END $$;

\echo
\echo '══ Usuários que serão APAGADOS (nenhum registro da empresa mantida aponta para eles) ══'
SELECT u.id, u."fullName" AS nome, u.email FROM schs2vet.users u JOIN _cand c USING (id) ORDER BY u.id;

WITH d AS (DELETE FROM schs2vet.tb_audit_logs WHERE "empresaId" IS NULL AND "userId" IN (SELECT id FROM _cand) RETURNING 1)
INSERT INTO _rel SELECT 'schs2vet.tb_audit_logs', 'apagada (acesso de usuário removido)', count(*) FROM d HAVING count(*) > 0;
WITH d AS (DELETE FROM schs2vet.users WHERE id IN (SELECT id FROM _cand) RETURNING 1)
INSERT INTO _rel SELECT 'schs2vet.users', 'apagado (sem vínculo restante)', count(*) FROM d;

-- Agora tudo: o que ainda depender de usuário removido é apagado e, por último, o que
-- SOBRA apontando para registro apagado tem o campo zerado (e entra no relatório).
SELECT pg_temp.resolver_orfaos(:empresa, true)  \gset _
SELECT pg_temp.resolver_orfaos(:empresa, false) \gset _

-- ── 5. Tokens e WhatsApp de desenvolvimento ──────────────────────────────────
WITH d AS (UPDATE schs2vet.users SET "refreshToken" = NULL, "resetPasswordToken" = NULL, "resetPasswordExpires" = NULL
           WHERE "refreshToken" IS NOT NULL OR "resetPasswordToken" IS NOT NULL RETURNING 1)
INSERT INTO _rel SELECT 'schs2vet.users', 'tokens de sessão/senha zerados', count(*) FROM d HAVING count(*) > 0;
WITH d AS (DELETE FROM schs2vet.tb_mfa_desafios RETURNING 1)
INSERT INTO _rel SELECT 'schs2vet.tb_mfa_desafios', 'apagada (desafio de 2FA)', count(*) FROM d HAVING count(*) > 0;
WITH d AS (UPDATE schs2vet.tb_empresa_configuracoes
           SET wa_instance = NULL, wa_status = 'DESCONECTADO', wa_status_em = NULL
           WHERE wa_instance IS NOT NULL OR wa_status <> 'DESCONECTADO' RETURNING 1)
INSERT INTO _rel SELECT 'schs2vet.tb_empresa_configuracoes', 'WhatsApp de dev desconectado', count(*) FROM d HAVING count(*) > 0;

-- ── Trava final: a empresa mantida não perdeu nada ───────────────────────────
DO $$
DECLARE r record; n bigint; emp int := current_setting('limpeza.empresa')::int;
BEGIN
  FOR r IN SELECT * FROM _antes LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = %s', r.tabela, r.col, emp) INTO n;
    IF n < r.n THEN
      RAISE EXCEPTION 'A empresa % perderia linhas em % (% → %). Nada foi alterado.', emp, r.tabela, r.n, n;
    END IF;
  END LOOP;
END $$;

\echo
\echo '══ O que muda, por tabela ══'
SELECT replace(tabela, 'schs2vet.', '') AS tabela, acao, sum(linhas) AS linhas
FROM _rel GROUP BY 1, 2 ORDER BY 1, 2;

\echo
\echo '══ Fica em produção ══'
SELECT (SELECT count(*) FROM schs2vet.tb_empresas)            AS empresas,
       (SELECT count(*) FROM schs2vet.users)                  AS usuarios,
       (SELECT count(*) FROM schs2vet.tb_animais)             AS pacientes,
       (SELECT count(*) FROM schs2vet.tb_evolucoes_clinicas)  AS evolucoes,
       (SELECT count(*) FROM schs2vet.tb_faturas)             AS faturas;
SELECT id, "fullName" AS nome, email, role FROM schs2vet.users ORDER BY id;

\if :aplicar
  COMMIT;
  \echo
  \echo '✅ APLICADO. Rode o backup agora: sudo /usr/local/sbin/s2vet-backup.sh'
\else
  ROLLBACK;
  \echo
  \echo 'ℹ️  SIMULAÇÃO — nada foi alterado. Para aplicar: -v aplicar=1'
\endif
