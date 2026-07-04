-- AlterTable: tipo de regra de fechamento de fatura (dia fixo | dia útil | último dia do mês)
ALTER TABLE "schs2vet"."tb_empresa_configuracoes"
  ADD COLUMN "tipoFechamento" TEXT;
