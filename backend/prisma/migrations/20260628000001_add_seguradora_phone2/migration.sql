-- Add seguradora field to tb_animais
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "seguradora" VARCHAR(150);

-- Add phone2 (segundo telefone) to users
ALTER TABLE "schs2vet"."users" ADD COLUMN IF NOT EXISTS "phone2" VARCHAR(30);
