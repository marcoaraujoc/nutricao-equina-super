-- Migration: animal_children_cascade
-- Adiciona ON DELETE CASCADE em todas as tabelas filhas de Animal.
-- Necessário para que a exclusão de um usuário (que cascateia nos animais)
-- não seja bloqueada pelas tabelas clínicas/nutricionais relacionadas ao animal.

-- PlanoDieta
ALTER TABLE "schs2vet"."tb_planos_dieta" DROP CONSTRAINT IF EXISTS "tb_planos_dieta_animalId_fkey";
ALTER TABLE "schs2vet"."tb_planos_dieta" ADD CONSTRAINT "tb_planos_dieta_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dieta (itens de dieta)
ALTER TABLE "schs2vet"."tb_dieta" DROP CONSTRAINT IF EXISTS "tb_dieta_animalId_fkey";
ALTER TABLE "schs2vet"."tb_dieta" ADD CONSTRAINT "tb_dieta_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ExameNutricional
ALTER TABLE "schs2vet"."tb_exames_nutricionais" DROP CONSTRAINT IF EXISTS "tb_exames_nutricionais_animalId_fkey";
ALTER TABLE "schs2vet"."tb_exames_nutricionais" ADD CONSTRAINT "tb_exames_nutricionais_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OcorrenciaSaude
ALTER TABLE "schs2vet"."tb_ocorrencias_saude" DROP CONSTRAINT IF EXISTS "tb_ocorrencias_saude_animalId_fkey";
ALTER TABLE "schs2vet"."tb_ocorrencias_saude" ADD CONSTRAINT "tb_ocorrencias_saude_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EvolucaoClinica
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" DROP CONSTRAINT IF EXISTS "tb_evolucoes_clinicas_animalId_fkey";
ALTER TABLE "schs2vet"."tb_evolucoes_clinicas" ADD CONSTRAINT "tb_evolucoes_clinicas_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EvolucaoMidia (cascateia via EvolucaoClinica já, mas adicionamos explicitamente)
ALTER TABLE "schs2vet"."tb_evolucao_midias" DROP CONSTRAINT IF EXISTS "tb_evolucao_midias_evolucaoId_fkey";
ALTER TABLE "schs2vet"."tb_evolucao_midias" ADD CONSTRAINT "tb_evolucao_midias_evolucaoId_fkey"
  FOREIGN KEY ("evolucaoId") REFERENCES "schs2vet"."tb_evolucoes_clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prescricao
ALTER TABLE "schs2vet"."tb_prescricoes" DROP CONSTRAINT IF EXISTS "tb_prescricoes_animalId_fkey";
ALTER TABLE "schs2vet"."tb_prescricoes" ADD CONSTRAINT "tb_prescricoes_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PrescricaoGrupo
ALTER TABLE "schs2vet"."tb_prescricao_grupos" DROP CONSTRAINT IF EXISTS "tb_prescricao_grupos_animalId_fkey";
ALTER TABLE "schs2vet"."tb_prescricao_grupos" ADD CONSTRAINT "tb_prescricao_grupos_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- VacinaClinica
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" DROP CONSTRAINT IF EXISTS "tb_vacinas_clinicas_animalId_fkey";
ALTER TABLE "schs2vet"."tb_vacinas_clinicas" ADD CONSTRAINT "tb_vacinas_clinicas_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EncaminhamentoClinico
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" DROP CONSTRAINT IF EXISTS "tb_encaminhamentos_clinicos_animalId_fkey";
ALTER TABLE "schs2vet"."tb_encaminhamentos_clinicos" ADD CONSTRAINT "tb_encaminhamentos_clinicos_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ExameClinico
ALTER TABLE "schs2vet"."tb_exames_clinicos" DROP CONSTRAINT IF EXISTS "tb_exames_clinicos_animalId_fkey";
ALTER TABLE "schs2vet"."tb_exames_clinicos" ADD CONSTRAINT "tb_exames_clinicos_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RelatorioSalvo
ALTER TABLE "schs2vet"."tb_relatorios_salvos" DROP CONSTRAINT IF EXISTS "tb_relatorios_salvos_animalId_fkey";
ALTER TABLE "schs2vet"."tb_relatorios_salvos" ADD CONSTRAINT "tb_relatorios_salvos_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fatura: animalId já nullable — garantir SET NULL
ALTER TABLE "schs2vet"."tb_faturas" DROP CONSTRAINT IF EXISTS "tb_faturas_animalId_fkey";
ALTER TABLE "schs2vet"."tb_faturas" ADD CONSTRAINT "tb_faturas_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FaturaItem: animalId já nullable — garantir SET NULL
ALTER TABLE "schs2vet"."tb_fatura_itens" DROP CONSTRAINT IF EXISTS "tb_fatura_itens_animalId_fkey";
ALTER TABLE "schs2vet"."tb_fatura_itens" ADD CONSTRAINT "tb_fatura_itens_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "schs2vet"."tb_animais"("id") ON DELETE SET NULL ON UPDATE CASCADE;