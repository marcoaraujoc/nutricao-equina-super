-- AlterTable: add resenha-related fields to tb_animais
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "pelagem"             VARCHAR(100);
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "altura"              VARCHAR(50);
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "registro_passaporte" VARCHAR(100);
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "finalidade"          VARCHAR(100);
