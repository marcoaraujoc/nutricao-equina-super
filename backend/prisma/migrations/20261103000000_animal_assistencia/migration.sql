-- Assistência veterinária mensal passa a ser POR ANIMAL (antes era do proprietário).
-- ADITIVA e SEM BACKFILL: NULL = sem assistência. Quem já era mensalista segue sendo
-- cobrado pelo valor legado do proprietário até que algum animal dele receba valor
-- (ver FaturaController.adicionarAssistenciaMensal) — copiar o valor do dono para cada
-- animal multiplicaria a cobrança de quem tem vários.
-- Sem RLS novo: tb_animais já está sob RLS tenant-direto e ADD COLUMN não toca policy.
ALTER TABLE "schs2vet"."tb_animais" ADD COLUMN IF NOT EXISTS "valor_assistencia" DOUBLE PRECISION;
