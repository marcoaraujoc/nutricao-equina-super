-- Migration: adiciona motivo_inativacao em tb_vacinas_clinicas
-- Vacinas excluídas (ativo=false) devem registrar a justificativa da exclusão.

ALTER TABLE schs2vet.tb_vacinas_clinicas
ADD COLUMN IF NOT EXISTS motivo_inativacao TEXT;
