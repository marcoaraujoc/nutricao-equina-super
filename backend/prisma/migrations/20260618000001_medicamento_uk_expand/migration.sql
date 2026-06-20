-- Migration: 20260618000001_medicamento_uk_expand
-- Remove a constraint única (nome, formaFarmaceutica, apresentacao).
-- A unicidade passa a ser gerenciada em nível de aplicação (controller),
-- incluindo fabricante e via de administração nos 5 campos da chave.

DROP INDEX IF EXISTS schs2vet."tb_medicamentos_nome_forma_apresentacao_key";
