-- Histórico de senhas — impede reuso das últimas 6 senhas (a atual em users.password_hash
-- + as últimas 5 aqui). Populado no momento da troca de senha (guarda o hash ANTIGO,
-- prestes a ser substituído); podado para manter só as 5 entradas mais recentes por usuário.

CREATE TABLE IF NOT EXISTS "schs2vet"."tb_password_history" (
  "id"            SERIAL PRIMARY KEY,
  "user_id"       INTEGER NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_schema = 'schs2vet'
                   AND table_name = 'tb_password_history'
                   AND constraint_name = 'tb_password_history_user_id_fkey') THEN
    ALTER TABLE "schs2vet"."tb_password_history"
      ADD CONSTRAINT "tb_password_history_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "schs2vet"."users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_password_history_user_id_created_at_idx"
  ON "schs2vet"."tb_password_history" ("user_id", "created_at");
