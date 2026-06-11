-- CreateTable: tb_fornecedores (catálogo global de fornecedores/profissionais)
-- Tabela separada da tb_users; SYSTEM criado pelo ADMIN, CLIENTE pelos sócios/vets

CREATE TABLE IF NOT EXISTS schs2vet.tb_fornecedores (
  id            SERIAL PRIMARY KEY,
  nome          VARCHAR(255) NOT NULL,
  cpf           VARCHAR(20),
  cnpj          VARCHAR(20),
  telefone      VARCHAR(30),
  tipo_servico  VARCHAR(50) NOT NULL,
  tipo_entrada  VARCHAR(10) NOT NULL DEFAULT 'CLIENTE',
  cep           VARCHAR(10),
  endereco      VARCHAR(500),
  complemento   VARCHAR(255),
  bairro        VARCHAR(255),
  cidade        VARCHAR(255),
  estado        VARCHAR(2),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
