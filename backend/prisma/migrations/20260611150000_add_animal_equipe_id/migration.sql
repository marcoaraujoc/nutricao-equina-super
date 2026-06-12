-- Animal.equipeId — equipe responsável pelo animal dentro da empresa.
-- Necessário para segregar permissões de PROPRIETARIO por equipe (antes a resolução
-- usava todas as equipes da empresa, vazando grants entre equipes do mesmo gestor).

ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "equipeId" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tb_animais_equipeId_fkey'
  ) THEN
    ALTER TABLE "schs2vet"."tb_animais"
      ADD CONSTRAINT "tb_animais_equipeId_fkey"
      FOREIGN KEY ("equipeId") REFERENCES "schs2vet"."tb_equipes"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tb_animais_equipeId_idx" ON "schs2vet"."tb_animais"("equipeId");

-- Backfill: equipe do vet responsável (VINCULO ACEITO) dentro da empresa do animal.
-- Se o vet pertence a várias equipes da empresa, usa a mais antiga (createdAt asc),
-- consistente com o fallback de resolveEquipeId no middleware de permissão.
UPDATE "schs2vet"."tb_animais" a
SET "equipeId" = sub.equipe_id
FROM (
  SELECT DISTINCT ON (a2.id) a2.id AS animal_id, m."equipeId" AS equipe_id
  FROM "schs2vet"."tb_animais" a2
  JOIN "schs2vet"."tb_vet_animal_solicitacoes" s
    ON s."animalId" = a2.id AND s.tipo = 'VINCULO' AND s.status = 'ACEITO'
  JOIN "schs2vet"."tb_membros_equipe" m ON m."userId" = s."vetUserId"
  JOIN "schs2vet"."tb_equipes" e ON e.id = m."equipeId" AND e."empresaId" = a2."empresaId"
  WHERE a2."empresaId" IS NOT NULL
  ORDER BY a2.id, m."createdAt" ASC
) sub
WHERE a.id = sub.animal_id AND a."equipeId" IS NULL;
