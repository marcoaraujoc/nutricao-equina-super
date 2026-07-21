-- Especialidade do combo de procedimentos (todos os itens do combo são dela).
-- Usada para filtrar combos por especialidade na prescrição. Nullable (legado).
ALTER TABLE "schs2vet"."tb_procedimento_combos" ADD COLUMN "especialidade" VARCHAR(100);
