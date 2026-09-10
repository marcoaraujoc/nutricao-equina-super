-- ============================================================================
-- CARGO **PRESTADOR** — novo, ao lado de FORNECEDOR. NADA É MIGRADO.
-- ============================================================================
--
-- Até 2026-09-08 existia UM cargo de profissional externo, `FORNECEDOR`, e a tela o
-- exibia como "Prestador" (só o rótulo — ver CLAUDE.md §12, sessão 2026-09-08 parte 5).
-- O pedido de 2026-09-09 separou os dois: `PRESTADOR` passa a ser um cargo PRÓPRIO.
--
-- 🔴 **NENHUM DADO EXISTENTE É ALTERADO** (foi o pedido, textualmente): todo membro já
-- cadastrado continua com cargo `FORNECEDOR`, e `PRESTADOR` fica disponível para as
-- inclusões daqui em diante. Esta migration só ACRESCENTA — não há UPDATE nenhum.
--
-- O que ela cria, por EQUIPE:
--   1. o perfil `PRESTADOR` em `tb_perfis_equipe` (sem ele, o cargo não pode ser
--      escolhido — a FK de `tb_matriz_perfis` aponta para cá);
--   2. a matriz de permissões do `PRESTADOR`, COPIADA da do `FORNECEDOR` daquela
--      equipe.
--
-- ⚠️ POR QUE COPIAR DO FORNECEDOR e não semear o padrão do código: a clínica que já
-- configurou "o que o meu prestador pode fazer" configurou isso NO perfil FORNECEDOR,
-- que era o único que existia. Nascer com os defaults (quase tudo NENHUM) faria o cargo
-- novo aparecer como um perfil que não enxerga nada, e o gestor teria de refazer à mão
-- a configuração que ele já fez. `locked` viaja junto: é bloqueio do ADMIN da
-- plataforma e não pode se perder na cópia.
-- Depois de criada, cada matriz é editada de forma INDEPENDENTE — a cópia é só o ponto
-- de partida, não um vínculo permanente.
--
-- ⚠️ Equipe sem nenhuma linha de FORNECEDOR (base recém-criada, seed ainda não rodou)
-- fica só com o perfil e sem matriz: `getNivelPermissao` cai em
-- `PERMISSOES_PADRAO.PRESTADOR` (clone de FORNECEDOR, ver seeds/002) e
-- `PermissaoService.garantirPerfisPadrao` completa na primeira abertura da tela.
--
-- SEM alteração de schema: `MembroEquipe.cargo` é TEXT (sem limite) e
-- `UsuarioEmpresa.perfil` é VARCHAR(20) — 'PRESTADOR' tem 9 caracteres.
--
-- 🔴 `set_config('app.plataforma', ...)` É OBRIGATÓRIO (armadilha 42 do CLAUDE.md):
-- `tb_perfis_equipe` e `tb_matriz_perfis` estão sob RLS com FORCE ROW LEVEL SECURITY,
-- que vale até para o dono do schema — quem roda a migration. Sem o carimbo, os dois
-- INSERTs abaixo gravariam ZERO linha, com sucesso e sem aviso. `true` = LOCAL à
-- transação da migration: o carimbo morre com ela e não vaza para a conexão seguinte.
SELECT set_config('app.plataforma', 'on', true);

-- 1. O perfil, em toda equipe que ainda não o tem (idempotente).
--
-- 🔴 `updatedAt` É OBRIGATÓRIO AQUI, e isto derrubou a primeira tentativa desta
-- migration (2026-09-10, `23502 null value in column "updatedAt"`): o campo é
-- `@updatedAt` no Prisma, o que significa que quem o preenche é o CLIENT — a coluna no
-- banco é NOT NULL e **sem DEFAULT**. INSERT por SQL cru tem de informá-lo.
-- ⚠️ `createdAt` não precisa: aquele é `@default(now())`, que existe como DEFAULT no
-- banco de verdade. A diferença entre os dois não aparece no schema.prisma a olho nu.
-- ⚠️ `NOW() AT TIME ZONE 'UTC'`, nunca `NOW()` puro: a coluna é `timestamp` SEM fuso e
-- o Prisma a lê como UTC — `NOW()` gravaria a hora local como se fosse UTC e a linha
-- voltaria 3h atrasada (regra de SQL cru do CLAUDE.md §6).
INSERT INTO "schs2vet"."tb_perfis_equipe" ("equipeId", "slug", "label", "descricao", "updatedAt")
SELECT e."id",
       'PRESTADOR',
       'Prestador',
       'Prestador de serviços externo (ferrador, fisioterapeuta…). Acesso configurável pelo gestor da equipe.',
       NOW() AT TIME ZONE 'UTC'
  FROM "schs2vet"."tb_equipes" e
 WHERE NOT EXISTS (
         SELECT 1
           FROM "schs2vet"."tb_perfis_equipe" p
          WHERE p."equipeId" = e."id"
            AND p."slug"     = 'PRESTADOR'
       );

-- 2. A matriz, copiada da do FORNECEDOR da MESMA equipe (idempotente).
INSERT INTO "schs2vet"."tb_matriz_perfis" ("equipeId", "perfilSlug", "moduloSlug", "nivel", "locked")
SELECT m."equipeId", 'PRESTADOR', m."moduloSlug", m."nivel", m."locked"
  FROM "schs2vet"."tb_matriz_perfis" m
 WHERE m."perfilSlug" = 'FORNECEDOR'
   AND EXISTS (
         SELECT 1
           FROM "schs2vet"."tb_perfis_equipe" p
          WHERE p."equipeId" = m."equipeId"
            AND p."slug"     = 'PRESTADOR'
       )
   AND NOT EXISTS (
         SELECT 1
           FROM "schs2vet"."tb_matriz_perfis" x
          WHERE x."equipeId"   = m."equipeId"
            AND x."perfilSlug" = 'PRESTADOR'
            AND x."moduloSlug" = m."moduloSlug"
       );
