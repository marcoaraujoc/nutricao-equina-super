-- E-mail do fornecedor — obrigatório na aplicação (nullable para registros legados).
-- Usado para vincular o cadastro Fornecedor à conta de login (User FORNECEDOR).
ALTER TABLE "schs2vet"."tb_fornecedores" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);
