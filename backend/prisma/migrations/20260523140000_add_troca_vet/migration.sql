-- AlterTable: adiciona novoVetUserId ao VetAnimalSolicitacao para suportar fluxo TROCA_VET
ALTER TABLE "schs2vet"."tb_vet_animal_solicitacoes"
  ADD COLUMN "novoVetUserId" INTEGER;

-- FK para o novo vet (nullable, SET NULL ao deletar user)
ALTER TABLE "schs2vet"."tb_vet_animal_solicitacoes"
  ADD CONSTRAINT "tb_vet_animal_solicitacoes_novoVetUserId_fkey"
  FOREIGN KEY ("novoVetUserId")
  REFERENCES "schs2vet"."users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index para buscas por novo vet
CREATE INDEX "tb_vet_animal_solicitacoes_novoVetUserId_idx"
  ON "schs2vet"."tb_vet_animal_solicitacoes"("novoVetUserId");