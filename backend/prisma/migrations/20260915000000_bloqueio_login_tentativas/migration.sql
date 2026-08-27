-- Bloqueio de conta por tentativas de senha erradas.
--
-- POR QUE: o rate limit de `/auth` é por IP (20 req/15min) — protege o SERVIDOR de
-- força bruta em volume, mas não protege UMA CONTA de um ataque distribuído nem de
-- alguém tentando a senha do colega da própria clínica. Contar a falha por USUÁRIO e
-- travar a conta é a proteção que faltava.
--
-- O contador vive no `users` porque a credencial é GLOBAL: e-mail e senha são a
-- identidade da pessoa em todas as empresas (ver CLAUDE.md §5, ProprietarioPerfil /
-- ProfissionalPerfil — o que é POR EMPRESA é o cadastro, nunca a credencial). Contar
-- por empresa deixaria 6 tentativas disponíveis em cada uma.
--
-- `bloqueado_em` NULL = conta liberada. Não há expiração automática de propósito: o
-- desbloqueio é um ATO de alguém (gestor da empresa, ou ADMIN quando o bloqueado é
-- gestor), e é isso que deixa rastro na auditoria. Trava que se solta sozinha depois
-- de N minutos não avisa ninguém de que houve tentativa.
--
-- Sem RLS novo: `users` é control plane (a mesma pessoa atende várias empresas), como
-- já é hoje.

ALTER TABLE "schs2vet"."users"
  ADD COLUMN IF NOT EXISTS "tentativas_login" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bloqueado_em"     TIMESTAMP(3);

-- Consulta usada pelas telas de Equipe/Usuários para destacar quem está travado.
-- Índice PARCIAL: só as contas bloqueadas entram, e elas são a exceção — o índice
-- fica minúsculo mesmo numa base com milhares de usuários.
CREATE INDEX IF NOT EXISTS "users_bloqueado_em_idx"
  ON "schs2vet"."users" ("bloqueado_em")
  WHERE "bloqueado_em" IS NOT NULL;
