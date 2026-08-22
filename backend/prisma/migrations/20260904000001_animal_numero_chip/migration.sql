-- Novo campo opcional no cadastro do animal: número do microchip. Mesma UX do
-- "Registro / Passaporte N°" já existente — texto livre, sem validação de formato
-- nem unicidade.
ALTER TABLE "schs2vet"."tb_animais"
  ADD COLUMN IF NOT EXISTS "numero_chip" VARCHAR(50);
