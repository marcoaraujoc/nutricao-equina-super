-- Validade do plano em DIAS, preenchida pelo ADMIN (2026-08-06).
-- NULL = sem validade (não expira). Consumida na criação da assinatura para
-- calcular AssinaturaEmpresa.fim_em = inicio_em + validade_dias.
ALTER TABLE "schs2vet"."tb_planos" ADD COLUMN IF NOT EXISTS "validade_dias" INTEGER;
