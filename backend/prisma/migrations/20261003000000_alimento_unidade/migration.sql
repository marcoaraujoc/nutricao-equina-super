-- Alimento: unidade padrão (kg, g, L, mL, unidade, porção)
-- O campo já existia na TELA de cadastro (criaAlimentos.tsx) e na listagem, e o
-- controller já o enviava — só não havia onde gravá-lo: o create do Prisma morria com
-- "Unknown argument `unidade`". ADITIVA: nenhuma linha existente é alterada.
-- NULA = alimento cadastrado antes desta coluna (a tela exibe "—").
ALTER TABLE "schs2vet"."tb_alimentos"
  ADD COLUMN IF NOT EXISTS "unidade" TEXT;
