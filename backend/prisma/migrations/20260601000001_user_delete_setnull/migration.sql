-- Migration: user_delete_setnull
-- Torna nullable todos os campos que referenciam User em tabelas clínicas/financeiras/auditoria.
-- Adiciona ON DELETE SET NULL para que a exclusão de um usuário não bloqueie a operação
-- e preserve os registros históricos (evoluções, prescrições, exames, etc.).

-- Dieta: criadopor, modificadopor
ALTER TABLE "schs2vet"."tb_dieta" ALTER COLUMN "criadopor" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_dieta" ALTER COLUMN "modificadopor" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_dieta" DROP CONSTRAINT IF EXISTS "tb_dieta_criadopor_fkey";
ALTER TABLE "schs2vet"."tb_dieta" DROP CONSTRAINT IF EXISTS "tb_dieta_modificadopor_fkey";
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_criadopor_fkey"
  FOREIGN KEY ("criadopor") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_modificadopor_fkey"
  FOREIGN KEY ("modificadopor") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ExameClinico: veterinarioId
ALTER TABLE "schs2vet"."tb_exames_clinicos" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_exames_clinicos" DROP CONSTRAINT IF EXISTS "tb_exames_clinicos_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_exames_clinicos" ADD CONSTRAINT "tb_exames_clinicos_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EvolucaoClinica: veterinarioId, modificadoPorId
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" DROP CONSTRAINT IF EXISTS "tb_evolucoes_clinicas_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" DROP CONSTRAINT IF EXISTS "tb_evolucoes_clinicas_modificadoPorId_fkey";
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_modificadoPorId_fkey"
  FOREIGN KEY ("modificadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prescricao: veterinarioId
ALTER TABLE "schs2vet"."tb_prescricoes" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_prescricoes" DROP CONSTRAINT IF EXISTS "tb_prescricoes_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_prescricoes" ADD CONSTRAINT "tb_prescricoes_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PrescricaoGrupo: veterinarioId, finalizadoPorId, executadoPorId
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_prescricao_grupos" DROP CONSTRAINT IF EXISTS "tb_prescricao_grupos_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_prescricao_grupos" DROP CONSTRAINT IF EXISTS "tb_prescricao_grupos_finalizadoPorId_fkey";
ALTER TABLE "schs2vet"."tb_prescricao_grupos" DROP CONSTRAINT IF EXISTS "tb_prescricao_grupos_executadoPorId_fkey";
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ADD CONSTRAINT "tb_prescricao_grupos_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ADD CONSTRAINT "tb_prescricao_grupos_finalizadoPorId_fkey"
  FOREIGN KEY ("finalizadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ADD CONSTRAINT "tb_prescricao_grupos_executadoPorId_fkey"
  FOREIGN KEY ("executadoPorId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VacinaClinica: veterinarioId
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" DROP CONSTRAINT IF EXISTS "tb_vacinas_clinicas_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ADD CONSTRAINT "tb_vacinas_clinicas_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EncaminhamentoClinico: veterinarioId
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" DROP CONSTRAINT IF EXISTS "tb_encaminhamentos_clinicos_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ADD CONSTRAINT "tb_encaminhamentos_clinicos_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fatura: proprietarioId (só recria a FK se a coluna já existir — pode ter sido adicionada fora de migration)
ALTER TABLE "schs2vet"."tb_faturas" DROP CONSTRAINT IF EXISTS "tb_faturas_proprietarioId_fkey";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'schs2vet'
      AND table_name   = 'tb_faturas'
      AND column_name  = 'proprietarioId'
  ) THEN
    ALTER TABLE "schs2vet"."tb_faturas"
      ADD CONSTRAINT "tb_faturas_proprietarioId_fkey"
      FOREIGN KEY ("proprietarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- FaturaItem: veterinarioId
ALTER TABLE "schs2vet"."tb_fatura_itens" ALTER COLUMN "veterinarioId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_fatura_itens" DROP CONSTRAINT IF EXISTS "tb_fatura_itens_veterinarioId_fkey";
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_veterinarioId_fkey"
  FOREIGN KEY ("veterinarioId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog: userId (logs de auditoria sobrevivem à exclusão do usuário)
ALTER TABLE "schs2vet"."tb_audit_logs" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_audit_logs" DROP CONSTRAINT IF EXISTS "tb_audit_logs_userId_fkey";
ALTER TABLE "schs2vet"."tb_audit_logs" ADD CONSTRAINT "tb_audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Empresa: ownerId (empresa sobrevive à exclusão do dono)
ALTER TABLE "schs2vet"."tb_empresas" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "schs2vet"."tb_empresas" DROP CONSTRAINT IF EXISTS "tb_empresas_ownerId_fkey";
ALTER TABLE "schs2vet"."tb_empresas" ADD CONSTRAINT "tb_empresas_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "schs2vet"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;