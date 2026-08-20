-- Checkbox "Atender somente no local de trabalho" (Incluir/Editar Membro).
-- false (padrão) = atende em qualquer local — nada muda. true = a listagem de animais
-- deste profissional fica restrita aos que estão num dos locais de trabalho dele
-- configurados para o dia de hoje (lib/animalScope.js).

-- AlterTable
ALTER TABLE "schs2vet"."tb_membros_equipe" ADD COLUMN "restringir_por_local" BOOLEAN NOT NULL DEFAULT false;
