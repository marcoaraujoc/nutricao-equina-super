-- Um gestor pode ter mais de uma empresa/equipe.
-- Duplicidade bloqueada apenas quando CPF/CNPJ + nome + e-mail (ownerId) coincidem.

-- DropIndex: cnpj deixa de ser único globalmente (mesmo CNPJ pode existir com nome/owner diferentes)
DROP INDEX "schs2vet"."tb_empresas_cnpj_key";

-- CreateIndex: empresa única por (ownerId, nome, cnpj)
-- Obs.: cnpj NULL (empresa pessoal/CPF) não é coberto — Postgres trata NULLs como distintos;
-- esse caso é bloqueado na camada de aplicação (EquipeController/EquipeService).
CREATE UNIQUE INDEX "tb_empresas_ownerId_nome_cnpj_key" ON "schs2vet"."tb_empresas"("ownerId", "nome", "cnpj");

-- CreateIndex: nome de equipe único dentro da empresa
CREATE UNIQUE INDEX "tb_equipes_empresaId_nome_key" ON "schs2vet"."tb_equipes"("empresaId", "nome");
