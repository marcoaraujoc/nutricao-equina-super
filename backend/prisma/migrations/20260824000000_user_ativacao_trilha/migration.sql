-- Trilha de ATIVAÇÃO/INATIVAÇÃO de um usuário (tela Equipe) — quem fez e quando.
--
-- `users.ativo` sozinho só diz o estado ATUAL: a tela de Equipe (abas Ativos/
-- Inativos) e a Auditoria precisam responder TAMBÉM "desde quando" e "por quem"
-- — ver EquipeController.toggleMembro / lib/usuarioAtivacao.js.
--
-- Sem FK CASCADE: excluir o usuário que fez a ação não pode apagar nem alterar
-- o estado do usuário afetado — SET NULL preserva a data, só perde o nome de
-- quem fez (mesmo padrão de `tb_animais.inativo_por_id`, migration
-- 20260818000000_animal_inativo).

ALTER TABLE "schs2vet"."users"
  ADD COLUMN IF NOT EXISTS "ativo_em"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ativo_por_id"   INTEGER,
  ADD COLUMN IF NOT EXISTS "inativo_em"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inativo_por_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_ativo_por_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."users"
      ADD CONSTRAINT "users_ativo_por_id_fkey"
      FOREIGN KEY ("ativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_inativo_por_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."users"
      ADD CONSTRAINT "users_inativo_por_id_fkey"
      FOREIGN KEY ("inativo_por_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_ativo_por_id_idx"   ON "schs2vet"."users"("ativo_por_id");
CREATE INDEX IF NOT EXISTS "users_inativo_por_id_idx" ON "schs2vet"."users"("inativo_por_id");
