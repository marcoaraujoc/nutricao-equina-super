-- User.equipeId — equipe que cadastrou o proprietário (segregação por equipe).
-- Complementa Animal.equipeId: proprietário sem animais (cadastro direto) também
-- precisa pertencer a uma equipe para não aparecer nas listas das outras equipes.

ALTER TABLE "schs2vet"."users" ADD COLUMN IF NOT EXISTS "equipe_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_equipe_id_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."users"
      ADD CONSTRAINT "users_equipe_id_fkey"
      FOREIGN KEY ("equipe_id") REFERENCES "schs2vet"."tb_equipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_equipe_id_idx" ON "schs2vet"."users"("equipe_id");

-- Backfill: proprietário vinculado a empresa cujos animais ativos estão todos numa
-- ÚNICA equipe dessa empresa → herda essa equipe. Ambíguo/sem animais → null
-- (legado: visível para a empresa inteira até ser reatribuído).
UPDATE "schs2vet"."users" u
SET "equipe_id" = sub.eq
FROM (
  SELECT a."userId" AS uid, MIN(a."equipeId") AS eq
  FROM "schs2vet"."tb_animais" a
  WHERE a."equipeId" IS NOT NULL AND a.ativo = true
  GROUP BY a."userId"
  HAVING COUNT(DISTINCT a."equipeId") = 1
) sub
WHERE u.id = sub.uid
  AND u."empresa_id" IS NOT NULL
  AND u."equipe_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "schs2vet"."tb_equipes" e
    WHERE e.id = sub.eq AND e."empresaId" = u."empresa_id"
  );
