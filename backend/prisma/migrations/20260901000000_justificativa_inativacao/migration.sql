-- Justificativa (motivo) na INATIVAÇÃO de Equipe/Fornecedor/Prestador/Tratador/
-- Proprietário/Paciente — complementa a trilha de quem/quando já existente
-- (migrations 20260824000000..20260827000001). Sem ela, o motivo exigido no
-- endpoint (ver controllers) só ficava no AuditLog — a aba Inativos não tinha
-- como exibi-lo como coluna própria.
--
-- `tb_animais` usa "desativado_motivo" (não "inativo_motivo"): essa tabela já tem
-- uma coluna "inativo_motivo" para um recurso DIFERENTE (Animal.inativo — bloqueio
-- de somente-leitura, o paciente continua visível). A exclusão lógica
-- (Animal.ativo=false, paciente some de tudo) usa os nomes "desativado_*", e o
-- motivo segue a mesma família.

ALTER TABLE "schs2vet"."users"                  ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_fornecedores"        ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_prestadores"         ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_tratadores"          ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_proprietario_perfis" ADD COLUMN IF NOT EXISTS "inativo_motivo" TEXT;
ALTER TABLE "schs2vet"."tb_animais"             ADD COLUMN IF NOT EXISTS "desativado_motivo" TEXT;
